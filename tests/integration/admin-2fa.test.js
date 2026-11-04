'use strict';
// Security #2: admin 2-factor login (Authenticator app codes)
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { totp } = require('../../src/utils/totp');

const PW = 'Adm1nPassw0rd';
let admin, token;
beforeEach(async () => {
  await resetDb();
  admin = await prisma.adminUser.create({ data: { id: uuid(), email: 'boss@admin.test',
    passwordHash: bcrypt.hashSync(PW, 4), role: 'ADMIN', isActive: true, status: 'active' } });
  token = (await api().post(`${API}/admin/auth/login`).send({ email: admin.email, password: PW })).body.data.token;
});
afterAll(() => prisma.$disconnect());
const as = () => ({ Authorization: `Bearer ${token}` });

test('setup → enable → login now needs the code', async () => {
  const s = await api().post(`${API}/admin/auth/2fa/setup`).set(as());
  expect(s.status).toBe(200);
  const { secret, otpauthUrl } = s.body.data;
  expect(otpauthUrl).toContain('otpauth://totp/');
  // secret is not stored in plain text
  expect((await prisma.adminUser.findUnique({ where: { id: admin.id } })).twoFactorSecret).not.toContain(secret);

  expect((await api().post(`${API}/admin/auth/2fa/enable`).set(as()).send({ otp: '000000' === totp(secret) ? '111111' : '000000' })).status).toBe(400);
  expect((await api().post(`${API}/admin/auth/2fa/enable`).set(as()).send({ otp: totp(secret) })).status).toBe(200);

  const noCode = await api().post(`${API}/admin/auth/login`).send({ email: admin.email, password: PW });
  expect(noCode.status).toBe(401);
  expect(noCode.body.errors?.code ?? noCode.body.code ?? JSON.stringify(noCode.body)).toMatch(/OTP_REQUIRED/);
  const bad = await api().post(`${API}/admin/auth/login`).send({ email: admin.email, password: PW, otp: '123456' === totp(secret) ? '654321' : '123456' });
  expect(bad.status).toBe(401);
  const ok = await api().post(`${API}/admin/auth/login`).send({ email: admin.email, password: PW, otp: totp(secret) });
  expect(ok.status).toBe(200);
});

test('turning it off needs password + code', async () => {
  const { secret } = (await api().post(`${API}/admin/auth/2fa/setup`).set(as())).body.data;
  await api().post(`${API}/admin/auth/2fa/enable`).set(as()).send({ otp: totp(secret) });
  expect((await api().post(`${API}/admin/auth/2fa/disable`).set(as()).send({ password: 'wrong', otp: totp(secret) })).status).toBe(400);
  expect((await api().post(`${API}/admin/auth/2fa/disable`).set(as()).send({ password: PW, otp: totp(secret) })).status).toBe(200);
  expect((await api().post(`${API}/admin/auth/login`).send({ email: admin.email, password: PW })).status).toBe(200);
});

test('/auth/me tells the panel whether 2FA is on', async () => {
  const r = await api().get(`${API}/admin/auth/me`).set(as());
  expect(r.body.data.twoFactorEnabled).toBe(false);
});
