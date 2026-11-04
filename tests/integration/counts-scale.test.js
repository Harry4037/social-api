'use strict';
// 1000-user load test: Prisma `_count` relation counts become
// "LEFT JOIN (SELECT … GROUP BY …)" over the WHOLE matches / sessions /
// messages tables on every /auth/me, Discover and chat-list call.
// Counts are now fetched only for the users / chats on the page.
// Also: buddyCount used to count only matches where you were "user A".
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies } = require('../helpers/factory');
const { withUserCounts } = require('../../src/utils/relationCounts');
const { v4: uuid } = require('uuid');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const done = (userId, buddyId) => prisma.workoutSession.create({ data: { id: uuid(), userId, buddyId,
  activity: 'gym', status: 'completed', scheduledAt: new Date(Date.now() - 864e5), endTime: new Date(Date.now() - 864e5 + 3600e3) } });

test('withUserCounts: buddies on both sides, completed sessions as host or buddy', async () => {
  const [A, B, C] = await Promise.all([makeUser(), makeUser(), makeUser()]);
  await makeBuddies(A.user, B.user); // A is userA
  await makeBuddies(C.user, A.user); // A is userB
  await done(A.user.id, B.user.id); await done(C.user.id, A.user.id);
  await prisma.workoutSession.create({ data: { id: uuid(), userId: A.user.id, activity: 'gym', status: 'missed',
    scheduledAt: new Date(), endTime: new Date() } });
  const [a, b] = await withUserCounts([A.user, B.user]);
  expect(a._count).toEqual({ matchesA: 2, sessionsAsUser: 2 });
  expect(b._count).toEqual({ matchesA: 1, sessionsAsUser: 1 });
});

test('/auth/me returns the right buddy + session counts', async () => {
  const [A, B, C] = await Promise.all([makeUser(), makeUser(), makeUser()]);
  await makeBuddies(B.user, A.user); await makeBuddies(C.user, A.user);
  await done(B.user.id, A.user.id);
  const r = await api().get(`${API}/auth/me`).set(A.auth);
  const u = r.body.data.user ?? r.body.data;
  expect(u.buddyCount).toBe(2);
  expect(u.sessionCount).toBe(1);
});

test('chat list unread + member counts are per chat', async () => {
  const [A, B, C] = await Promise.all([makeUser(), makeUser(), makeUser()]);
  const { chat } = await makeBuddies(A.user, B.user);
  const other = await makeBuddies(B.user, C.user);
  for (const [chatId, senderId] of [[chat.id, B.user.id], [chat.id, B.user.id], [chat.id, A.user.id], [other.chat.id, C.user.id]]) {
    await prisma.message.create({ data: { id: uuid(), chatId, senderId, content: 'x' } });
  }
  const g = await prisma.chat.create({ data: { id: uuid(), isGroup: true, groupName: 'G', lastMessageAt: new Date(),
    members: { create: [{ userId: A.user.id }, { userId: B.user.id }, { userId: C.user.id }] } } });
  await prisma.message.create({ data: { id: uuid(), chatId: g.id, senderId: C.user.id, content: 'hi' } });
  const list = (await api().get(`${API}/chat`).set(A.auth)).body.data;
  expect(list.find(c => c.id === chat.id).unreadCount).toBe(2);
  expect(list.find(c => c.id === g.id)).toMatchObject({ unreadCount: 1, memberCount: 3 });
});
