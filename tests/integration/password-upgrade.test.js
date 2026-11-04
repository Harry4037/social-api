'use strict';
// Existing users (bcrypt hashes) keep logging in; their hash is upgraded.
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, PASSWORD } = require('../helpers/factory');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

test('sign-up stores a scrypt hash', async () => {
  const r = await api().post(`${API}/auth/register`).send({ email: 'new@x.com', password: 'Seshlly@2026', firstName: 'A', lastName: 'B' });
  expect(r.status).toBe(201);
  expect((await prisma.user.findUnique({ where: { email: 'new@x.com' } })).passwordHash).toMatch(/^scrypt\$/);
});

test('old bcrypt user logs in and is upgraded to scrypt', async () => {
  const { user } = await makeUser();
  expect(user.passwordHash).toMatch(/^\$2/);
  const r = await api().post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD });
  expect(r.status).toBe(200);
  await new Promise(res => setTimeout(res, 300)); // upgrade runs after the reply
  const h = (await prisma.user.findUnique({ where: { id: user.id } })).passwordHash;
  expect(h).toMatch(/^scrypt\$/);
  // and still works with the new hash
  expect((await api().post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD })).status).toBe(200);
  expect((await api().post(`${API}/auth/login`).send({ email: user.email, password: 'Wrong123' })).status).toBe(401);
});
