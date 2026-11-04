'use strict';
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const mailSvc = require('../../src/services/mail.service');

const reg = (body = {}) => api().post(`${API}/auth/register`).send({
  email: 'Ravi.Kumar@gmail.com', password: 'Passw0rd!', firstName: 'Ravi', lastName: 'Kumar', ...body });
const login = (email, password) => api().post(`${API}/auth/login`).send({ email, password });

describe('Auth', () => {
  beforeEach(resetDb);
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => prisma.$disconnect());

  test('register → login → /me', async () => {
    const r = await reg();
    expect(r.status).toBe(201);
    expect(r.body.data.user).not.toHaveProperty('passwordHash');
    const l = await login('ravi.kumar@gmail.com', 'Passw0rd!');
    expect(l.status).toBe(200);
    const me = await api().get(`${API}/auth/me`).set('Authorization', `Bearer ${l.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.firstName ?? me.body.data.user?.firstName).toBe('Ravi');
  });

  test('duplicate email (any case) → 409', async () => {
    await reg();
    expect((await reg({ email: 'RAVI.KUMAR@gmail.com' })).status).toBe(409);
  });

  test('weak password rejected', async () => {
    expect((await reg({ password: 'short' })).status).toBe(422);
  });

  test('wrong password and unknown email give the same answer', async () => {
    await reg();
    const a = await login('ravi.kumar@gmail.com', 'nope12345');
    const b = await login('nobody@gmail.com', 'nope12345');
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.message).toBe(b.body.message);
  });

  test('banned user cannot log in or use an old token', async () => {
    const r = await reg();
    await prisma.user.update({ where: { id: r.body.data.user.id }, data: { isBanned: true } });
    expect((await login('ravi.kumar@gmail.com', 'Passw0rd!')).status).toBe(403);
    const me = await api().get(`${API}/auth/me`).set('Authorization', `Bearer ${r.body.data.accessToken}`);
    expect(me.status).toBe(403);
  });

  test('refresh token rotates; the old one stops working; logout revokes', async () => {
    const r = await reg();
    const old = r.body.data.refreshToken;
    const f = await api().post(`${API}/auth/refresh`).send({ refreshToken: old });
    expect(f.status).toBe(200);
    expect((await api().post(`${API}/auth/refresh`).send({ refreshToken: old })).status).toBe(401);
    const fresh = f.body.data.refreshToken;
    await api().post(`${API}/auth/logout`).set('Authorization', `Bearer ${f.body.data.accessToken}`).send({ refreshToken: fresh });
    expect((await api().post(`${API}/auth/refresh`).send({ refreshToken: fresh })).status).toBe(401);
  });

  describe('forgot password', () => {
    let sent;
    beforeEach(() => {
      sent = [];
      jest.spyOn(mailSvc, 'sendPasswordResetOtp').mockImplementation(async (to, name, otp) => { sent.push(otp); return { sent: true }; });
    });

    test('works when the user types the email exactly as registered (dots, capitals)', async () => {
      await reg();
      const f = await api().post(`${API}/auth/forgot-password`).send({ email: 'Ravi.Kumar@gmail.com' });
      expect(f.status).toBe(200);
      expect(sent).toHaveLength(1);
    });

    test('unknown email → same message, no mail', async () => {
      const f = await api().post(`${API}/auth/forgot-password`).send({ email: 'ghost@gmail.com' });
      expect(f.status).toBe(200);
      expect(sent).toHaveLength(0);
    });

    test('asking again within a minute does not reveal the account (no 429)', async () => {
      await reg();
      await api().post(`${API}/auth/forgot-password`).send({ email: 'ravi.kumar@gmail.com' });
      const again = await api().post(`${API}/auth/forgot-password`).send({ email: 'ravi.kumar@gmail.com' });
      const ghost = await api().post(`${API}/auth/forgot-password`).send({ email: 'ghost@gmail.com' });
      expect(again.status).toBe(ghost.status);
      expect(again.body.message).toBe(ghost.body.message);
      expect(sent).toHaveLength(1);
    });

    test('5 wrong codes lock the code; right code after that fails', async () => {
      await reg();
      await api().post(`${API}/auth/forgot-password`).send({ email: 'ravi.kumar@gmail.com' });
      const wrong = sent[0] === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        expect((await api().post(`${API}/auth/verify-otp`).send({ email: 'ravi.kumar@gmail.com', otp: wrong })).status).toBe(400);
      }
      const ok = await api().post(`${API}/auth/verify-otp`).send({ email: 'ravi.kumar@gmail.com', otp: sent[0] });
      expect(ok.status).toBe(400);
    });

    test('reset: new password works, old fails, other devices logged out', async () => {
      const r = await reg();
      await api().post(`${API}/auth/forgot-password`).send({ email: 'ravi.kumar@gmail.com' });
      const x = await api().post(`${API}/auth/reset-password`)
        .send({ email: 'Ravi.Kumar@gmail.com', otp: sent[0], newPassword: 'NewPassw0rd!' });
      expect(x.status).toBe(200);
      expect((await login('ravi.kumar@gmail.com', 'Passw0rd!')).status).toBe(401);
      expect((await login('ravi.kumar@gmail.com', 'NewPassw0rd!')).status).toBe(200);
      expect((await api().post(`${API}/auth/refresh`).send({ refreshToken: r.body.data.refreshToken })).status).toBe(401);
      // code cannot be reused
      const again = await api().post(`${API}/auth/reset-password`)
        .send({ email: 'ravi.kumar@gmail.com', otp: sent[0], newPassword: 'Another1!' });
      expect(again.status).toBe(400);
    });
  });
});
