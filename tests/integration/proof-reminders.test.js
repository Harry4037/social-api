'use strict';
// Found while writing the user manual:
//  • "Upload proof" push went out every 30 min for 8 h (up to 16 pushes),
//    starting while people were still working out, and only to the host.
//  • An old second "missed session" job charged 2 tokens (could go below 0)
//    next to the real rule (Trust −5, 1 token).
// Now: ONE reminder when the session ends, to everyone who can upload;
// ONE missed rule.
const fs = require('fs');
const path = require('path');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');
const { sendProofReminders } = require('../../src/controllers/session.controller');
const { v4: uuid } = require('uuid');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());
const M = 60e3;
const mk = (userId, buddyId, endedMinAgo) => prisma.workoutSession.create({ data: { id: uuid(), userId, buddyId,
  activity: 'gym', scheduledAt: new Date(Date.now() - (endedMinAgo + 60) * M), endTime: new Date(Date.now() - endedMinAgo * M),
  ...(buddyId && { participants: { create: { id: uuid(), userId: buddyId, status: 'confirmed' } } }) } });
const proofPushes = (userId) => prisma.notification.count({ where: { userId, type: 'proof' } });

test('one reminder right after the session ends, to host and confirmed buddy', async () => {
  const A = await makeUser(); const B = await makeUser();
  await mk(A.user.id, B.user.id, 10);
  await sendProofReminders();
  expect(await proofPushes(A.user.id)).toBe(1);
  expect(await proofPushes(B.user.id)).toBe(1);
});

test('no reminder while the workout is still running, or long after', async () => {
  const A = await makeUser();
  await mk(A.user.id, null, -20); // ends in 20 min
  await mk(A.user.id, null, 120); // ended 2 h ago (already reminded)
  await sendProofReminders();
  expect(await proofPushes(A.user.id)).toBe(0);
});

test('no proof reminder once proof is uploaded', async () => {
  const A = await makeUser();
  const s = await mk(A.user.id, null, 5);
  await prisma.workoutSession.update({ where: { id: s.id }, data: { proofUploadedAt: new Date(), proofImageUrl: 'x' } });
  await sendProofReminders();
  expect(await proofPushes(A.user.id)).toBe(0);
});

test('only one "missed session" rule exists', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/schedulers/scheduler.js'), 'utf8');
  expect(src).not.toMatch(/markMissedSessions/);
  expect(src).toMatch(/markIncomplete/);
});
