'use strict';
// Load test: every user opening the leaderboard re-ran the same sort over
// the whole users table (p95 28 s, timeouts at 1000 users). The top list is
// now cached for a short time; blocks / my rank are still applied per user.
process.env.LEADERBOARD_CACHE_MS = '60000';
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');
const { _clearLeaderboardCache } = require('../../src/controllers/challenge.controller');

beforeEach(async () => { await resetDb(); _clearLeaderboardCache(); });
afterAll(() => prisma.$disconnect());
const board = async (u) => (await api().get(`${API}/global-leaderboard`).set(u.auth)).body.data;

test('cached board still hides someone I block afterwards, ranks stay 1..n', async () => {
  const A = await makeUser({ xpTotal: 900 }); const B = await makeUser({ xpTotal: 500 });
  const V = await makeUser({ xpTotal: 100 });
  expect((await board(V)).entries.map(e => e.userId)).toEqual([A.user.id, B.user.id, V.user.id]);
  await api().post(`${API}/safety/block`).set(V.auth).send({ userId: A.user.id });
  const b = await board(V);
  expect(b.entries.map(e => e.userId)).toEqual([B.user.id, V.user.id]);
  expect(b.entries.map(e => e.rank)).toEqual([1, 2]);
  expect(b.myRank).toBe(2);
});

test('my own XP change shows right away (my row is never from cache)', async () => {
  const A = await makeUser({ xpTotal: 900 }); const V = await makeUser({ xpTotal: 100 });
  await board(V);
  await prisma.user.update({ where: { id: V.user.id }, data: { xpTotal: 1000 } });
  const b = await board(V);
  expect(b.myRank).toBe(1);
  expect(b.entries.find(e => e.userId === V.user.id).xpTotal).toBe(1000);
});
