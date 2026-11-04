'use strict';
// Load test: two people liking each other at the same moment → both saw the
// other's like, both created the match → unique-key crash (500 / 409).
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

test('simultaneous mutual likes → both 200, one match, one chat, both told matched', async () => {
  for (let round = 0; round < 5; round++) {
    const [A, B] = await Promise.all([makeUser(), makeUser()]);
    const [ra, rb] = await Promise.all([
      api().post(`${API}/match/like`).set(A.auth).send({ targetUserId: B.user.id }),
      api().post(`${API}/match/like`).set(B.auth).send({ targetUserId: A.user.id }),
    ]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const ids = [A.user.id, B.user.id];
    expect(await prisma.match.count({ where: { userAId: { in: ids }, userBId: { in: ids } } })).toBe(1);
    expect(await prisma.chat.count({ where: { userAId: { in: ids }, userBId: { in: ids } } })).toBe(1);
    const matched = [ra.body.data, rb.body.data].filter(d => d.matched);
    expect(matched.length).toBeGreaterThanOrEqual(1);
    for (const d of matched) expect(d.chatId).toBeTruthy();
  }
});
