'use strict';
// Product #1: brand-new users (< 48 h) are shown early in Discover so their
// first day isn't empty.  Product #3: "On my way" button before a session.
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies } = require('../helpers/factory');
const { v4: uuid } = require('uuid');

const H = 3600e3;
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('New-user boost in Discover', () => {
  test('a user who joined < 48 h ago is ranked before older users and flagged isNew', async () => {
    const me = await makeUser({ latitude: 28.5355, longitude: 77.391, primaryActivity: 'gym' });
    const old = await makeUser({ latitude: 28.54, longitude: 77.395, primaryActivity: 'gym', lastActiveAt: new Date(), createdAt: new Date(Date.now() - 30 * 24 * H) });
    const fresh = await makeUser({ latitude: 28.54, longitude: 77.395, primaryActivity: 'running', lastActiveAt: new Date(Date.now() - H), createdAt: new Date(Date.now() - 5 * H) });
    const r = await api().get(`${API}/match/discover`).set(me.auth);
    expect(r.status).toBe(200);
    const ids = r.body.data.map(x => x.id);
    expect(ids.indexOf(fresh.user.id)).toBeLessThan(ids.indexOf(old.user.id));
    expect(r.body.data.find(x => x.id === fresh.user.id).isNew).toBe(true);
    expect(r.body.data.find(x => x.id === old.user.id).isNew).toBe(false);
  });

  test('paid boost still beats the new-user boost', async () => {
    const me = await makeUser({ latitude: 28.5355, longitude: 77.391 });
    const fresh = await makeUser({ latitude: 28.54, longitude: 77.395, createdAt: new Date(Date.now() - H) });
    const paid = await makeUser({ latitude: 28.54, longitude: 77.395, createdAt: new Date(Date.now() - 90 * 24 * H), boostExpiresAt: new Date(Date.now() + H) });
    const ids = (await api().get(`${API}/match/discover`).set(me.auth)).body.data.map(x => x.id);
    expect(ids.slice(0, 2)).toEqual([paid.user.id, fresh.user.id]);
  });
});

describe('On my way', () => {
  let A, B, chat;
  const mkSession = (startInMin, data = {}) => prisma.workoutSession.create({ data: {
    id: uuid(), userId: A.user.id, buddyId: B.user.id, activity: 'gym', gymName: 'Iron Gym',
    scheduledAt: new Date(Date.now() + startInMin * 60e3), endTime: new Date(Date.now() + (startInMin + 60) * 60e3),
    participants: { create: { id: uuid(), userId: B.user.id, status: 'confirmed' } }, ...data } });
  const omw = (u, id) => api().post(`${API}/sessions/${id}/on-my-way`).set(u.auth);
  beforeEach(async () => {
    A = await makeUser(); B = await makeUser();
    ({ chat } = await makeBuddies(A.user, B.user));
  });

  test('works within 90 min of the start, tells the buddy and posts in chat', async () => {
    const s = await mkSession(30);
    const r = await omw(B, s.id);
    expect(r.status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: A.user.id } })).toBe(1);
    const m = await prisma.message.findFirst({ where: { chatId: chat.id, type: 'system' } });
    expect(m.content).toMatch(/on (the|their) way/i);
    const mine = await api().get(`${API}/sessions/my`).set(A.auth);
    const got = (mine.body.data.sessions ?? mine.body.data).find(x => x.id === s.id);
    expect(got.onMyWay).toContain(B.user.id);
  });

  test('two people tapping at the same moment both succeed (load test found 409)', async () => {
    const C = await makeUser();
    const s = await mkSession(30);
    await prisma.sessionParticipant.create({ data: { id: uuid(), sessionId: s.id, userId: C.user.id, status: 'confirmed' } });
    const rs = await Promise.all([omw(A, s.id), omw(B, s.id), omw(C, s.id)]);
    expect(rs.map(r => r.status)).toEqual([200, 200, 200]);
    const after = await prisma.workoutSession.findUnique({ where: { id: s.id } });
    expect([...after.onMyWay].sort()).toEqual([A.user.id, B.user.id, C.user.id].sort());
  });

  test('only once per person', async () => {
    const s = await mkSession(30);
    expect((await omw(A, s.id)).status).toBe(200);
    expect((await omw(A, s.id)).status).toBe(409);
  });

  test('too early (session in 5 h) or already over → 400', async () => {
    expect((await omw(A, (await mkSession(300)).id)).status).toBe(400);
    expect((await omw(A, (await mkSession(-120)).id)).status).toBe(400);
  });

  test('a stranger or a pending invitee cannot use it', async () => {
    const C = await makeUser();
    const s = await mkSession(30);
    expect((await omw(C, s.id)).status).toBe(404);
    await prisma.sessionParticipant.updateMany({ where: { sessionId: s.id }, data: { status: 'pending' } });
    expect((await omw(B, s.id)).status).toBe(403);
  });
});
