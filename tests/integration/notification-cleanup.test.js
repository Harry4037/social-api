'use strict';
// Load test: 1000 users made ~9 300 notifications in one hour and nothing
// ever deleted them. Daily cleanup: read > 30 days, any > 90 days.
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');
const { pruneOldNotifications } = require('../../src/services/notification.service');
const { v4: uuid } = require('uuid');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());
const DAY = 864e5;
const n = (userId, daysAgo, isRead) => prisma.notification.create({ data: { id: uuid(), userId, type: 'system',
  title: 't', message: 'm', isRead, createdAt: new Date(Date.now() - daysAgo * DAY) } });

test('deletes old read (>30 d) and very old (>90 d) notifications only', async () => {
  const { user } = await makeUser();
  await n(user.id, 1, true); await n(user.id, 40, false); // keep
  await n(user.id, 40, true); await n(user.id, 100, false); // delete
  const r = await pruneOldNotifications({ batch: 1 }); // small batch → loops
  expect(r.deleted).toBe(2);
  expect(await prisma.notification.count()).toBe(2);
});
