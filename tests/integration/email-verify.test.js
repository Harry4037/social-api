'use strict';
// Security #1: anyone could register with someone else's email.
// Now: a 6-digit code is emailed at sign-up; rewards need a verified email.
const { v4: uuid } = require('uuid');
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');
const mailSvc = require('../../src/services/mail.service');

let codes;
beforeEach(async () => {
  await resetDb();
  codes = [];
  jest.spyOn(mailSvc, 'sendEmailVerificationCode').mockImplementation(async (_to, _n, otp) => { codes.push(otp); });
  jest.spyOn(mailSvc, 'sendPasswordResetOtp').mockImplementation(async () => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const register = () => api().post(`${API}/auth/register`).send({
  email: `v${Date.now()}@test.com`, password: 'Passw0rd!', firstName: 'Vee', lastName: 'R' });

test('sign-up sends a verification code; account starts unverified', async () => {
  const r = await register();
  expect(r.status).toBe(201);
  expect(r.body.data.user.emailVerified).toBe(false);
  expect(codes).toHaveLength(1);
});

test('right code verifies the email', async () => {
  const r = await register();
  const auth = { Authorization: `Bearer ${r.body.data.accessToken}` };
  const v = await api().post(`${API}/auth/email/verify`).set(auth).send({ otp: codes[0] });
  expect(v.status).toBe(200);
  expect((await prisma.user.findUnique({ where: { id: r.body.data.user.id } })).emailVerified).toBe(true);
});

test('wrong code ×5 locks the code', async () => {
  const r = await register();
  const auth = { Authorization: `Bearer ${r.body.data.accessToken}` };
  const wrong = codes[0] === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    expect((await api().post(`${API}/auth/email/verify`).set(auth).send({ otp: wrong })).status).toBe(400);
  }
  expect((await api().post(`${API}/auth/email/verify`).set(auth).send({ otp: codes[0] })).status).toBe(400);
});

test('resend is limited to once a minute', async () => {
  const r = await register();
  const auth = { Authorization: `Bearer ${r.body.data.accessToken}` };
  expect((await api().post(`${API}/auth/email/send-code`).set(auth)).status).toBe(429);
});

test('a verification code cannot be used to reset the password (separate purpose)', async () => {
  const r = await register();
  const x = await api().post(`${API}/auth/reset-password`)
    .send({ email: r.body.data.user.email, otp: codes[0], newPassword: 'Hijack123!' });
  expect(x.status).toBe(400);
});

test('referral bonus waits for a verified email, then pays', async () => {
  const R = await makeUser({ emailVerified: true });
  const N = await makeUser({ emailVerified: false });
  await prisma.referral.create({ data: { id: uuid(), referrerId: R.user.id, referredId: N.user.id, code: 'RX1' } });
  const { rewardReferral } = require('../../src/controllers/referral.controller');
  expect(await rewardReferral(N.user.id)).toBe(false);          // not verified yet
  await prisma.user.update({ where: { id: N.user.id }, data: { emailVerified: true } });
  expect(await rewardReferral(N.user.id)).toBe(true);
});
