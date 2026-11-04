'use strict';
// Idempotency-Key: a bad network makes the app re-send the same action
// (timeout → retry, double tap). The server must do it ONCE and give the
// retry the same answer.
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies } = require('../helpers/factory');
const { pruneIdempotencyKeys } = require('../../src/middleware/idempotency');

let A, B, chat;
beforeEach(async () => {
  await resetDb();
  A = await makeUser({ chatTokens: 10 }); B = await makeUser();
  ({ chat } = await makeBuddies(A.user, B.user));
});
afterAll(() => prisma.$disconnect());
const send = (key, content = 'hello', u = A) => {
  const r = api().post(`${API}/chat/${chat.id}/messages`).set(u.auth);
  if (key) r.set('Idempotency-Key', key);
  return r.send({ content });
};

test('retry with the same key → one message, one token charged, same reply', async () => {
  const r1 = await send('msg-key-0001');
  const r2 = await send('msg-key-0001');
  expect(r1.status).toBe(201);
  expect(r2.status).toBe(201);
  expect(r2.headers['idempotent-replayed']).toBe('true');
  expect(r2.body.data.id).toBe(r1.body.data.id);
  expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(1);
  expect((await prisma.user.findUnique({ where: { id: A.user.id } })).chatTokens).toBe(9);
});

test('5 copies at the same moment → exactly one message', async () => {
  const rs = await Promise.all(Array.from({ length: 5 }, () => send('msg-key-burst')));
  const codes = rs.map(r => r.status).sort();
  expect(codes.filter(c => c === 201).length).toBeGreaterThanOrEqual(1);
  expect(codes.every(c => c === 201 || c === 409)).toBe(true); // 409 = "still working, retry"
  expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(1);
});

test('same key, different body → 422 (key reused by mistake)', async () => {
  await send('msg-key-0002', 'one');
  const r = await send('msg-key-0002', 'two');
  expect(r.status).toBe(422);
  expect(r.body.errors.code).toBe('IDEMPOTENCY_KEY_REUSED');
});

test('keys are per user — another user with the same key is a new request', async () => {
  B.auth && await prisma.user.update({ where: { id: B.user.id }, data: { chatTokens: 5 } });
  await send('shared-key-01', 'from A');
  const r = await send('shared-key-01', 'from A', B);
  expect(r.status).toBe(201);
  expect(r.headers['idempotent-replayed']).toBeUndefined();
  expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(2);
});

test('no key → old behaviour (old app versions keep working)', async () => {
  await send(null); await send(null);
  expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(2);
});

test('failures that may succeed later are not remembered (401 / 5xx)', async () => {
  const bad = await api().post(`${API}/chat/${chat.id}/messages`)
    .set('Authorization', 'Bearer nope').set('Idempotency-Key', 'msg-key-0003').send({ content: 'x' });
  expect(bad.status).toBe(401);
  const ok = await send('msg-key-0003', 'x');
  expect(ok.status).toBe(201); // same key works once logged in again
});

test('business errors ARE remembered (no double charge on retry of a refusal)', async () => {
  await prisma.user.update({ where: { id: A.user.id }, data: { chatTokens: 0 } });
  expect((await send('msg-key-0004')).status).toBe(402);
  await prisma.user.update({ where: { id: A.user.id }, data: { chatTokens: 5 } });
  const r = await send('msg-key-0004');
  expect(r.status).toBe(402);
  expect(r.headers['idempotent-replayed']).toBe('true');
});

test('bad key format → 400; keys expire after 24 h', async () => {
  expect((await send('short')).status).toBe(400);
  await send('msg-key-0005');
  await prisma.idempotencyKey.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
  expect((await pruneIdempotencyKeys()).deleted).toBe(1);
});

test('sign-up retry after a timeout returns the same account, not "email already registered"', async () => {
  const body = { email: 'retry@x.com', password: 'Seshlly@2026', firstName: 'R', lastName: 'T' };
  const r1 = await api().post(`${API}/auth/register`).set('Idempotency-Key', 'signup-key-01').send(body);
  const r2 = await api().post(`${API}/auth/register`).set('Idempotency-Key', 'signup-key-01').send(body);
  expect(r1.status).toBe(201); expect(r2.status).toBe(201);
  expect(r2.body.data.user.id).toBe(r1.body.data.user.id);
});
