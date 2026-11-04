'use strict';
// Found while writing the user manual: a normal like stopped at 5 a day but
// a super-like checked 10 (same counter), and the day reset at 5:30 AM IST
// (UTC midnight). Now: one rule — 5 likes a day incl. super-likes on Free,
// new day at midnight India time.
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');
const { appDate } = require('../../src/utils/appDate');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

test('Free: 5 likes a day; a super-like counts as one of them', async () => {
  const me = await makeUser();
  const others = await Promise.all(Array.from({ length: 7 }, () => makeUser()));
  for (let i = 0; i < 4; i++) {
    expect((await api().post(`${API}/match/like`).set(me.auth).send({ targetUserId: others[i].user.id })).status).toBe(200);
  }
  const sl = await api().post(`${API}/match/swipe`).set(me.auth).send({ targetId: others[4].user.id, action: 'super_like' });
  expect(sl.status).toBe(200);
  const sixth = await api().post(`${API}/match/like`).set(me.auth).send({ targetUserId: others[5].user.id });
  expect(sixth.status).toBe(429);
  expect(sixth.body.errors.code).toBe('DAILY_LIMIT_REACHED');
  const sw = await api().post(`${API}/match/swipe`).set(me.auth).send({ targetId: others[6].user.id, action: 'like' });
  expect(sw.status).toBe(429);
});

test('skips are free and unlimited', async () => {
  const me = await makeUser();
  const others = await Promise.all(Array.from({ length: 7 }, () => makeUser()));
  for (const o of others) {
    expect((await api().post(`${API}/match/skip`).set(me.auth).send({ targetUserId: o.user.id })).status).toBe(200);
  }
});

test('the day changes at midnight India time, not 5:30 AM', () => {
  expect(appDate(new Date('2026-11-01T18:29:00Z'))).toBe('2026-11-01'); // 11:59 PM IST
  expect(appDate(new Date('2026-11-01T18:31:00Z'))).toBe('2026-11-02'); // 12:01 AM IST
});
