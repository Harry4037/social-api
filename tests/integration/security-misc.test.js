'use strict';
// More pen-test regressions (admin, CMS, OTP, streaks, influencer profile)
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies } = require('../helpers/factory');
const mailSvc = require('../../src/services/mail.service');

const adminToken = (admin) => jwt.sign({ adminId: admin.id, role: admin.role },
  process.env.ADMIN_JWT_SECRET || process.env.JWT_ACCESS_SECRET, { expiresIn: '1h' });
const mkAdmin = (data) => prisma.adminUser.create({ data: {
  id: uuid(), email: `${uuid()}@admin.test`, passwordHash: bcrypt.hashSync('Adm1nPassw0rd', 4),
  isActive: true, status: 'active', ...data } });

beforeEach(resetDb);
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

test('public blog never shows drafts', async () => {
  const a = await mkAdmin({ role: 'SUPER_ADMIN' });
  await prisma.blogArticle.create({ data: { id: uuid(), title: 'Secret', slug: 's1', content: 'x', category: 'app_update', status: 'draft', authorId: a.id } });
  const pub = await prisma.blogArticle.create({ data: { id: uuid(), title: 'Live', slug: 's2', content: 'x', category: 'app_update', status: 'published', authorId: a.id } });
  const list = await api().get(`${API}/cms/blog?status=draft`);
  const titles = list.body.articles.map(x => x.title);
  expect(titles).toEqual(['Live']);
  const draft = await prisma.blogArticle.findFirst({ where: { status: 'draft' } });
  expect((await api().get(`${API}/cms/blog/${draft.id}`)).status).toBe(404);
  expect((await api().get(`${API}/cms/blog/${pub.id}`)).status).toBe(200);
});

test('revoked CMS member is locked out immediately', async () => {
  const boss = await mkAdmin({ role: 'SUPER_ADMIN' });
  const member = await mkAdmin({ role: 'blog_editor' });
  const t = adminToken(member);
  const r = await api().put(`${API}/admin/cms/team/${member.id}/revoke`).set('Authorization', `Bearer ${adminToken(boss)}`);
  expect(r.status).toBe(200);
  expect((await api().get(`${API}/admin/auth/me`).set('Authorization', `Bearer ${t}`)).status).toBe(403);
  const login = await api().post(`${API}/admin/auth/login`).send({ email: member.email, password: 'Adm1nPassw0rd' });
  expect(login.status).toBe(401);
});

test('normal user token cannot reach admin routes', async () => {
  const U = await makeUser();
  const r = await api().get(`${API}/admin/users`).set(U.auth);
  expect([401, 403]).toContain(r.status);
});

test('OTP: 10 parallel wrong guesses still burn at most 5 attempts', async () => {
  let otp;
  jest.spyOn(mailSvc, 'sendPasswordResetOtp').mockImplementation(async (_t, _n, o) => { otp = o; });
  await api().post(`${API}/auth/register`).send({ email: 'otp@test.com', password: 'Passw0rd!', firstName: 'O', lastName: 'T' });
  await api().post(`${API}/auth/forgot-password`).send({ email: 'otp@test.com' });
  const wrong = otp === '000000' ? '111111' : '000000';
  await Promise.all(Array.from({ length: 10 }, () =>
    api().post(`${API}/auth/verify-otp`).send({ email: 'otp@test.com', otp: wrong })));
  const row = await prisma.passwordReset.findFirst();
  expect(row.attempts).toBeLessThanOrEqual(5);
});

test('flash streak only with buddies', async () => {
  const A = await makeUser(); const S = await makeUser();
  expect((await api().post(`${API}/flash/send`).set(A.auth).send({ buddyId: S.user.id })).status).toBe(403);
  expect((await api().post(`${API}/flash/send`).set(A.auth).send({ buddyId: 'nope' })).status).toBe(422);
});

test('flash streak goes up at most once per day', async () => {
  const A = await makeUser(); const B = await makeUser();
  await makeBuddies(A.user, B.user);
  for (let i = 0; i < 3; i++) {
    await api().post(`${API}/flash/send`).set(A.auth).send({ buddyId: B.user.id });
    await api().post(`${API}/flash/send`).set(B.auth).send({ buddyId: A.user.id });
  }
  const s = await prisma.flashStreak.findFirst();
  expect(s.currentStreak).toBe(1);
});

test('influencer profile link opens THAT influencer', async () => {
  const U = await makeUser();
  await makeUser({ isInfluencer: true, firstName: 'First' });
  const second = await makeUser({ isInfluencer: true, firstName: 'Second' });
  const r = await api().get(`${API}/influencer/${second.user.id}`).set(U.auth);
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body.data)).toContain('Second');
});

test('bad pagination values never cause a 500', async () => {
  const A = await makeUser(); const B = await makeUser();
  const { chat } = await makeBuddies(A.user, B.user);
  for (const q of ['page=-1&limit=abc', 'page=NaN&limit=1000000', 'limit=-5']) {
    expect((await api().get(`${API}/chat/${chat.id}/messages?${q}`).set(A.auth)).status).toBe(200);
    expect((await api().get(`${API}/notifications?${q}`).set(A.auth)).status).toBe(200);
    expect((await api().get(`${API}/match/buddies?${q}`).set(A.auth)).status).toBe(200);
  }
});
