'use strict';
// Product #5: streaks used to NEVER break (no reset job) and warnings used
// UTC days. Now: reminder at 9 PM IST, break after a missed day, and Pro
// users get one "streak freeze" per 30 days.
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies } = require('../helpers/factory');
const strike = require('../../src/controllers/strike.controller');
const { dayBounds } = require('../../src/controllers/session.controller');

const DAY = 864e5;
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const pair = async (aData = {}, bData = {}) => {
  const A = await makeUser(aData); const B = await makeUser(bData);
  const { match } = await makeBuddies(A.user, B.user);
  return { A, B, match };
};
const todayStart = () => dayBounds(new Date()).start.getTime();

test('streak kept when it went up yesterday', async () => {
  const { match } = await pair();
  await prisma.match.update({ where: { id: match.id }, data: { buddyStrikeStreak: 5, streakCountedAt: new Date(todayStart() - 2 * 3600e3) } });
  await strike.breakStrikeStreaks();
  expect((await prisma.match.findUnique({ where: { id: match.id } })).buddyStrikeStreak).toBe(5);
});

test('missed a whole day → streak resets to 0 and both are told', async () => {
  const { A, match } = await pair();
  await prisma.match.update({ where: { id: match.id }, data: { buddyStrikeStreak: 5, streakCountedAt: new Date(todayStart() - DAY - 3600e3) } });
  const r = await strike.breakStrikeStreaks();
  expect(r.broken).toBe(1);
  expect((await prisma.match.findUnique({ where: { id: match.id } })).buddyStrikeStreak).toBe(0);
  expect(await prisma.notification.count({ where: { userId: A.user.id } })).toBe(1);
});

test('Pro: one free streak freeze per 30 days', async () => {
  const { match } = await pair({ subscriptionPlan: 'pro', subscriptionExpiry: new Date(Date.now() + 30 * DAY) });
  const missed = { buddyStrikeStreak: 9, streakCountedAt: new Date(todayStart() - DAY - 3600e3) };
  await prisma.match.update({ where: { id: match.id }, data: missed });
  let r = await strike.breakStrikeStreaks();
  expect(r.frozen).toBe(1);
  let m = await prisma.match.findUnique({ where: { id: match.id } });
  expect(m.buddyStrikeStreak).toBe(9);
  expect(m.streakFreezeUsedAt).not.toBeNull();
  // misses again next day → freeze already used → breaks
  await prisma.match.update({ where: { id: match.id }, data: missed });
  r = await strike.breakStrikeStreaks();
  expect(r.broken).toBe(1);
});

test('9 PM reminder only for streaks not yet counted today (IST day)', async () => {
  const a = await pair(); const b = await pair();
  await prisma.match.update({ where: { id: a.match.id }, data: { buddyStrikeStreak: 3, lastStrikeAt: new Date(todayStart() - 3600e3) } });
  await prisma.match.update({ where: { id: b.match.id }, data: { buddyStrikeStreak: 3, lastStrikeAt: new Date(todayStart() + 60e3), streakCountedAt: new Date(todayStart() + 60e3) } });
  const r = await strike.sendStreakWarnings();
  expect(r.warned).toBe(1);
});
