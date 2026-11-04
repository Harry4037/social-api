'use strict';
// Product #6: group session chats were created but nobody could open them —
// every chat lookup only checked userAId / userBId (null for groups).
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');
const { v4: uuid } = require('uuid');

let A, B, C, X, chat;
beforeEach(async () => {
  await resetDb();
  [A, B, C, X] = await Promise.all([makeUser({ chatTokens: 10 }), makeUser({ chatTokens: 10 }), makeUser({ chatTokens: 10 }), makeUser({ chatTokens: 10 })]);
  chat = await prisma.chat.create({ data: { id: uuid(), isGroup: true, groupName: 'gym Session', lastMessageAt: new Date(),
    members: { create: [{ userId: A.user.id, isAdmin: true }, { userId: B.user.id }, { userId: C.user.id }] } } });
});
afterAll(() => prisma.$disconnect());

test('members see the group in their chat list with its name', async () => {
  const r = await api().get(`${API}/chat`).set(B.auth);
  expect(r.status).toBe(200);
  const g = r.body.data.find(c => c.id === chat.id);
  expect(g).toMatchObject({ isGroup: true, buddyName: 'gym Session', memberCount: 3 });
  expect((await api().get(`${API}/chat`).set(X.auth)).body.data.find(c => c.id === chat.id)).toBeUndefined();
});

test('members can send and read; everyone else gets 404', async () => {
  const s = await api().post(`${API}/chat/${chat.id}/messages`).set(A.auth).send({ content: 'See you at 7!' });
  expect(s.status).toBe(201);
  const m = await api().get(`${API}/chat/${chat.id}/messages`).set(C.auth);
  expect(m.status).toBe(200);
  expect(m.body.data.map(x => x.content)).toContain('See you at 7!');
  // both other members are notified
  expect(await prisma.notification.count({ where: { type: 'chat', userId: { in: [B.user.id, C.user.id] } } })).toBe(2);
  expect((await api().get(`${API}/chat/${chat.id}/messages`).set(X.auth)).status).toBe(404);
  expect((await api().post(`${API}/chat/${chat.id}/messages`).set(X.auth).send({ content: 'hi' })).status).toBe(404);
});

test('declining the session invite removes you from the group chat', async () => {
  const s = await prisma.workoutSession.create({ data: { id: uuid(), userId: A.user.id, buddyId: B.user.id, chatId: chat.id,
    activity: 'gym', scheduledAt: new Date(Date.now() + 864e5), endTime: new Date(Date.now() + 864e5 + 3600e3),
    participants: { create: [{ id: uuid(), userId: B.user.id }, { id: uuid(), userId: C.user.id }] } } });
  const r = await api().post(`${API}/sessions/${s.id}/respond`).set(C.auth).send({ action: 'decline' });
  expect(r.status).toBe(200);
  expect((await api().get(`${API}/chat/${chat.id}/messages`).set(C.auth)).status).toBe(404);
});
