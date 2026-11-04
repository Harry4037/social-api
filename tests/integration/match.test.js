'use strict';
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');

const swipe = (u, targetId, action = 'like') =>
  api().post(`${API}/match/swipe`).set(u.auth).send({ targetId, action });

describe('Matching', () => {
  let A, B;
  beforeEach(async () => {
    await resetDb();
    A = await makeUser({ firstName: 'Asha' });
    B = await makeUser({ firstName: 'Bala' });
  });
  afterAll(() => prisma.$disconnect());

  test('mutual like → one match + one chat; notification uses the name, not an id', async () => {
    expect((await swipe(A, B.user.id)).body.data.matched).toBe(false);
    const r = await swipe(B, A.user.id);
    expect(r.body.data.matched).toBe(true);
    const chat = await prisma.chat.findFirst();
    expect(r.body.data.chatId).toBe(chat.id);            // app opens the chat with this
    expect(await prisma.match.count()).toBe(1);
    expect(await prisma.chat.count()).toBe(1);
    const notes = await prisma.notification.findMany({ where: { userId: B.user.id } });
    expect(notes.map(n => `${n.title} ${n.message}`).join(' ')).not.toContain(A.user.id);
  });

  test('liking the same person again does not spam them with notifications', async () => {
    await swipe(A, B.user.id);
    await swipe(A, B.user.id);
    await swipe(A, B.user.id);
    expect(await prisma.notification.count({ where: { userId: B.user.id } })).toBe(1);
  });

  test('accepting a request twice does not create two matches (no 500)', async () => {
    await swipe(A, B.user.id);
    const s = await prisma.swipe.findFirst({ where: { swiperId: A.user.id } });
    const acc = await api().post(`${API}/match/requests/${s.id}/accept`).set(B.auth);
    expect(acc.status).toBe(200);
    expect(acc.body.data.chatId).toBe((await prisma.chat.findFirst()).id);
    const again = await api().post(`${API}/match/requests/${s.id}/accept`).set(B.auth);
    expect(again.status).toBe(409);
    expect(await prisma.match.count()).toBe(1);
  });

  test('a "skip" cannot be accepted as a match request', async () => {
    await swipe(A, B.user.id, 'skip');
    const s = await prisma.swipe.findFirst({ where: { swiperId: A.user.id } });
    const r = await api().post(`${API}/match/requests/${s.id}/accept`).set(B.auth);
    expect(r.status).toBe(404);
    expect(await prisma.match.count()).toBe(0);
  });

  test('cannot accept someone else\'s request', async () => {
    const C = await makeUser();
    await swipe(A, B.user.id);
    const s = await prisma.swipe.findFirst({ where: { swiperId: A.user.id } });
    expect((await api().post(`${API}/match/requests/${s.id}/accept`).set(C.auth)).status).toBe(403);
  });

  test('chat tokens never go below zero', async () => {
    await prisma.user.update({ where: { id: A.user.id }, data: { chatTokens: 0 } });
    await swipe(A, B.user.id);
    const a = await prisma.user.findUnique({ where: { id: A.user.id } });
    expect(a.chatTokens).toBeGreaterThanOrEqual(0);
  });

  test('requests list carries what the app needs (and hides blocked users)', async () => {
    const C = await makeUser({ firstName: 'Chetan' });
    await swipe(A, B.user.id); await swipe(C, B.user.id);
    await api().post(`${API}/safety/block`).set(B.auth).send({ userId: C.user.id });
    const r = await api().get(`${API}/match/requests`).set(B.auth);
    expect(r.status).toBe(200);
    expect(r.body.data.requests).toHaveLength(1);
    const u = r.body.data.requests[0].user;
    expect(u).toMatchObject({ id: A.user.id, firstName: 'Asha' });
    expect(u.createdAt).toBeTruthy();
    expect(u).not.toHaveProperty('email');
    expect(typeof u.trustScore).toBe('number');
  });

  test('blocked users never match', async () => {
    await api().post(`${API}/safety/block`).set(B.auth).send({ userId: A.user.id });
    await swipe(B, A.user.id);
    const r = await swipe(A, B.user.id);
    expect(r.status).toBe(404);
    expect(await prisma.match.count()).toBe(0);
  });
});
