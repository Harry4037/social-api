'use strict';
// Found while writing the user manual: the server had TWO level tables.
// Sessions used 0/500/1500… ("Grinder"), matches + the app used
// 0/100/300… ("Rookie"), so the push said one level and the profile another.
// Also: match XP skipped the weekly leaderboard, and two XP awards at the
// same moment could lose one (read-then-write).
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');
const xpCtrl = require('../../src/controllers/xp.controller');
const xpSvc = require('../../src/services/xp.service');
const { THRESHOLDS, levelName } = require('../../src/utils/xp');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

test('one level table everywhere (same as the app)', async () => {
  const { user } = await makeUser();
  await xpCtrl.awardXP(user.id, 100, 'session_complete');
  const u = await prisma.user.findUnique({ where: { id: user.id } });
  expect(u.level).toBe(2); // 100 XP = level 2 in the app's table
  const n = await prisma.notification.findFirst({ where: { userId: user.id, title: { contains: 'Level 2' } } });
  expect(n.title).toContain(levelName(2));
  expect(THRESHOLDS.at(1)).toBe(100);
});

test('match XP counts for the weekly and monthly leaderboards', async () => {
  const { user } = await makeUser();
  await xpSvc.awardXp(user.id, 'buddy_matched');
  const u = await prisma.user.findUnique({ where: { id: user.id } });
  expect([u.xpTotal, u.weeklyXp, u.monthlyXp]).toEqual([30, 30, 30]);
});

test('parallel XP awards are all kept', async () => {
  const { user } = await makeUser();
  await Promise.all(Array.from({ length: 10 }, () => xpCtrl.awardXP(user.id, 10, 'test')));
  const u = await prisma.user.findUnique({ where: { id: user.id } });
  expect(u.xpTotal).toBe(100);
  expect(await prisma.xpEvent.count({ where: { userId: user.id } })).toBe(10);
});
