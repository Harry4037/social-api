'use strict';
// Product #4: Sunday recap push — sessions, XP and city rank for the week.
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');
const { sendWeeklyRecap } = require('../../src/services/engagement.service');
const { v4: uuid } = require('uuid');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const xp = (userId, amount, daysAgo = 1) => prisma.xpEvent.create({ data: {
  id: uuid(), userId, action: 'session', xpAmount: amount, createdAt: new Date(Date.now() - daysAgo * 864e5) } });

test('sends one recap per active user with sessions, XP and city rank', async () => {
  const A = await makeUser({ city: 'Noida' }); const B = await makeUser({ city: 'Noida' });
  const idle = await makeUser({ city: 'Noida' });
  await xp(A.user.id, 100); await xp(B.user.id, 250); await xp(idle.user.id, 500, 10); // old XP ignored
  await prisma.workoutSession.create({ data: { id: uuid(), userId: A.user.id, activity: 'gym', status: 'completed',
    scheduledAt: new Date(Date.now() - 864e5), endTime: new Date(Date.now() - 864e5 + 3600e3) } });
  const r = await sendWeeklyRecap();
  expect(r.sent).toBe(2);
  const nA = await prisma.notification.findFirst({ where: { userId: A.user.id } });
  expect(nA.message).toMatch(/1 session · 100 XP · #2 in Noida/);
  const nB = await prisma.notification.findFirst({ where: { userId: B.user.id } });
  expect(nB.message).toMatch(/0 sessions · 250 XP · #1 in Noida/);
  expect(await prisma.notification.count({ where: { userId: idle.user.id } })).toBe(0);
});
