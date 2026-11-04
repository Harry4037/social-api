'use strict';
// /sessions/my now merges three indexed lookups (host / buddy / invited)
// instead of one OR + EXISTS that read every session row (load test).
// Also: parallel messages in one chat used to deadlock on chat.update.
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies } = require('../helpers/factory');
const { v4: uuid } = require('uuid');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());
const H = 3600e3;
const mk = (userId, buddyId, hoursAhead, extra = {}) => prisma.workoutSession.create({ data: { id: uuid(), userId, buddyId,
  activity: 'gym', scheduledAt: new Date(Date.now() + hoursAhead * H), endTime: new Date(Date.now() + (hoursAhead + 1) * H), ...extra } });

test('host, buddy and invited sessions all listed, newest first, paged by 20', async () => {
  const [A, B, C] = await Promise.all([makeUser(), makeUser(), makeUser()]);
  const host = await mk(A.user.id, B.user.id, 5);
  const buddy = await mk(B.user.id, A.user.id, 10);
  const guest = await mk(C.user.id, B.user.id, 1, { participants: { create: { id: uuid(), userId: A.user.id } } });
  await mk(B.user.id, C.user.id, 3); // not mine
  const r = await api().get(`${API}/sessions/my`).set(A.auth);
  expect(r.body.data.sessions.map(s => s.id)).toEqual([buddy.id, host.id, guest.id]);
  for (let i = 0; i < 22; i++) await mk(A.user.id, null, 20 + i, { status: 'completed' });
  const p1 = (await api().get(`${API}/sessions/my?page=1`).set(A.auth)).body.data.sessions;
  const p2 = (await api().get(`${API}/sessions/my?page=2`).set(A.auth)).body.data.sessions;
  expect(p1).toHaveLength(20); expect(p2).toHaveLength(5);
  expect(new Set([...p1, ...p2].map(s => s.id)).size).toBe(25);
  const done = (await api().get(`${API}/sessions/my?status=completed`).set(A.auth)).body.data.sessions;
  expect(done).toHaveLength(20);
  expect(done.every(s => s.status === 'completed')).toBe(true);
});

test('20 messages sent at once in one chat all succeed (no deadlock)', async () => {
  const A = await makeUser({ chatTokens: 50 }); const B = await makeUser({ chatTokens: 50 });
  const { chat } = await makeBuddies(A.user, B.user);
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    api().post(`${API}/chat/${chat.id}/messages`).set((i % 2 ? A : B).auth).send({ content: `m${i}` })));
  expect(rs.map(r => r.status).filter(s => s !== 201)).toEqual([]);
  expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(20);
  expect((await prisma.chat.findUnique({ where: { id: chat.id } })).lastMessage).toMatch(/^m\d+$/);
});
