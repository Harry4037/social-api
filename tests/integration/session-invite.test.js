'use strict';
// Bug #1 (tester report, 30 Oct): a session booked for 20 Oct 7 AM could
// still be "confirmed" days later. Invites must only be answerable before
// the session starts, only once, and the chat card must show the result
// to BOTH people.
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies, makeUpload } = require('../helpers/factory');
const sessCtrl = require('../../src/controllers/session.controller');

const HOUR = 60 * 60 * 1000;

const schedule = (auth, buddyId, at) =>
  api().post(`${API}/sessions`).set(auth).send({
    activity: 'gym', gymName: "Gold's Gym", scheduledAt: at.toISOString(), buddyIds: [buddyId],
  });

const inviteCard = (sessionId) =>
  prisma.message.findFirst({
    where: { type: 'session_invite', metadata: { path: '$.sessionId', equals: sessionId } },
  });

describe('Session invites', () => {
  let A, B, chat;
  beforeEach(async () => {
    await resetDb();
    A = await makeUser({ firstName: 'Shilpa' });
    B = await makeUser({ firstName: 'Sonu' });
    ({ chat } = await makeBuddies(A.user, B.user));
  });
  afterAll(() => prisma.$disconnect());

  test('scheduling in the past is rejected', async () => {
    const r = await schedule(A.auth, B.user.id, new Date(Date.now() - HOUR));
    expect(r.status).toBe(422);
  });

  test('buddy can confirm before the start time; card shows confirmed for both', async () => {
    const r = await schedule(A.auth, B.user.id, new Date(Date.now() + 5 * HOUR));
    expect(r.status).toBe(201);
    const id = r.body.data.id;

    const c = await api().post(`${API}/sessions/${id}/respond`).set(B.auth).send({ action: 'confirm' });
    expect(c.status).toBe(200);

    const p = await prisma.sessionParticipant.findFirst({ where: { sessionId: id, userId: B.user.id } });
    expect(p.status).toBe('confirmed');

    const card = await inviteCard(id);
    expect(card.chatId).toBe(chat.id);
    expect(card.metadata.status).toBe('confirmed');   // inviter's card no longer "Waiting…"
    // card is found by an indexed column, not a JSON scan of all messages (load test)
    expect(card.sessionId).toBe(card.metadata.sessionId);
  });

  test('cannot confirm once the session start time has passed (the reported bug)', async () => {
    const r = await schedule(A.auth, B.user.id, new Date(Date.now() + 2 * HOUR));
    const id = r.body.data.id;
    // time travel: the session was due an hour ago
    await prisma.workoutSession.update({
      where: { id },
      data: { scheduledAt: new Date(Date.now() - HOUR), endTime: new Date(Date.now()) },
    });

    const c = await api().post(`${API}/sessions/${id}/respond`).set(B.auth).send({ action: 'confirm' });
    expect(c.status).toBe(410);
    expect(c.body.message).toMatch(/expired/i);

    const p = await prisma.sessionParticipant.findFirst({ where: { sessionId: id, userId: B.user.id } });
    expect(p.status).not.toBe('confirmed');
  });

  test('cannot answer the same invite twice', async () => {
    const r = await schedule(A.auth, B.user.id, new Date(Date.now() + 5 * HOUR));
    const id = r.body.data.id;
    await api().post(`${API}/sessions/${id}/respond`).set(B.auth).send({ action: 'decline' });
    const again = await api().post(`${API}/sessions/${id}/respond`).set(B.auth).send({ action: 'confirm' });
    expect(again.status).toBe(409);
  });

  test('declining a 1:1 invite cancels the session and updates the card', async () => {
    const r = await schedule(A.auth, B.user.id, new Date(Date.now() + 5 * HOUR));
    const id = r.body.data.id;
    const d = await api().post(`${API}/sessions/${id}/respond`).set(B.auth).send({ action: 'decline' });
    expect(d.status).toBe(200);
    const s = await prisma.workoutSession.findUnique({ where: { id } });
    expect(s.status).toBe('cancelled');
    expect((await inviteCard(id)).metadata.status).toBe('declined');
  });

  test('a stranger cannot answer someone else\'s invite', async () => {
    const C = await makeUser();
    const r = await schedule(A.auth, B.user.id, new Date(Date.now() + 5 * HOUR));
    const c = await api().post(`${API}/sessions/${r.body.data.id}/respond`).set(C.auth).send({ action: 'confirm' });
    expect(c.status).toBe(403);
  });

  test('cron: unanswered invite expires after start — no penalty for the inviter', async () => {
    const r = await schedule(A.auth, B.user.id, new Date(Date.now() + 2 * HOUR));
    const id = r.body.data.id;
    await prisma.workoutSession.update({
      where: { id },
      data: { scheduledAt: new Date(Date.now() - 6 * HOUR), endTime: new Date(Date.now() - 5 * HOUR) },
    });
    const trustBefore = Number((await prisma.user.findUnique({ where: { id: A.user.id } })).trustScore);

    await sessCtrl.expireUnansweredInvites();
    await sessCtrl.markIncomplete();

    const s = await prisma.workoutSession.findUnique({ where: { id } });
    expect(s.status).toBe('cancelled');
    const p = await prisma.sessionParticipant.findFirst({ where: { sessionId: id, userId: B.user.id } });
    expect(p.status).toBe('expired');
    expect((await inviteCard(id)).metadata.status).toBe('expired');
    const trustAfter = Number((await prisma.user.findUnique({ where: { id: A.user.id } })).trustScore);
    expect(trustAfter).toBe(trustBefore);
  });

  test('same-day limit checks the session\'s day, not today', async () => {
    const day = new Date(Date.now() + 3 * 24 * HOUR); day.setHours(7, 0, 0, 0);
    const first = await schedule(A.auth, B.user.id, day);
    expect(first.status).toBe(201);
    const second = await schedule(A.auth, B.user.id, new Date(day.getTime() + 4 * HOUR));
    expect(second.status).toBe(409);
  });
});

describe('Session proof upload permissions', () => {
  let A, B;
  beforeEach(async () => {
    await resetDb();
    A = await makeUser(); B = await makeUser();
    await makeBuddies(A.user, B.user);
  });
  afterAll(() => prisma.$disconnect());

  const endedSession = async (inviteStatus) => {
    const r = await schedule(A.auth, B.user.id, new Date(Date.now() + 2 * HOUR));
    const id = r.body.data.id;
    await prisma.sessionParticipant.updateMany({ where: { sessionId: id, userId: B.user.id }, data: { status: inviteStatus } });
    await prisma.workoutSession.update({ where: { id }, data: {
      scheduledAt: new Date(Date.now() - 2 * HOUR), endTime: new Date(Date.now() - HOUR) } });
    return id;
  };
  const upload = async (u, id) => api().post(`${API}/sessions/${id}/proof`).set(u.auth)
    .send({ proofImageUrl: await makeUpload(u.user) });

  test('a buddy who declined cannot upload proof', async () => {
    const id = await endedSession('declined');
    expect((await upload(B, id)).status).toBe(403);
  });

  test('creator cannot upload proof when the buddy never accepted', async () => {
    const id = await endedSession('expired');
    expect((await upload(A, id)).status).toBe(409);
  });

  test('accepted buddy session → proof goes to the other person to confirm', async () => {
    const id = await endedSession('confirmed');
    const r = await upload(A, id);
    expect(r.status).toBe(200);
    expect(r.body.data.proofUploadedBy).toBe(A.user.id);
  });
});
