'use strict';
// Tester screenshot: messages from 15/10 appeared ABOVE 9/10, and with more
// than 30 messages the newest ones never loaded (server sent the oldest 30).
const { v4: uuid } = require('uuid');
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies } = require('../helpers/factory');

describe('Chat messages', () => {
  let A, B, chat;
  beforeEach(async () => {
    await resetDb();
    A = await makeUser(); B = await makeUser();
    ({ chat } = await makeBuddies(A.user, B.user));
  });
  afterAll(() => prisma.$disconnect());

  const seed = async (count) => {
    const base = Date.now() - count * 60_000;
    for (let i = 0; i < count; i++) {
      await prisma.message.create({
        data: { id: uuid(), chatId: chat.id, senderId: i % 2 ? A.user.id : B.user.id,
                content: `m${i}`, createdAt: new Date(base + i * 60_000) },
      });
    }
  };

  test('page 1 = the NEWEST messages, oldest → newest', async () => {
    await seed(35);
    const r = await api().get(`${API}/chat/${chat.id}/messages`).set(A.auth);
    expect(r.status).toBe(200);
    const contents = r.body.data.map(m => m.content);
    expect(contents).toHaveLength(30);
    expect(contents[0]).toBe('m5');
    expect(contents[29]).toBe('m34');
    expect(r.body.pagination.hasMore).toBe(true);
  });

  test('page 2 = the older ones, still oldest → newest', async () => {
    await seed(35);
    const r = await api().get(`${API}/chat/${chat.id}/messages?page=2`).set(A.auth);
    expect(r.body.data.map(m => m.content)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });

  test('outsider cannot read the chat', async () => {
    const C = await makeUser();
    const r = await api().get(`${API}/chat/${chat.id}/messages`).set(C.auth);
    expect(r.status).toBe(404);
  });
});

describe('GET /chat/with/:userId', () => {
  afterAll(() => prisma.$disconnect());
  test('returns my chat with a buddy; strangers get 404', async () => {
    await resetDb();
    const A = await makeUser(); const B = await makeUser(); const C = await makeUser();
    const { chat, match } = await makeBuddies(A.user, B.user);
    const r = await api().get(`${API}/chat/with/${B.user.id}`).set(A.auth);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ chatId: chat.id, matchId: match.id });
    expect((await api().get(`${API}/chat/with/${C.user.id}`).set(A.auth)).status).toBe(404);
  });
});
