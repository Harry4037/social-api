'use strict';
const { hashPassword, verifyPassword } = require('../../utils/password');
const jwt    = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const prisma = require('../../config/db');
const res_   = require('../../utils/response');
const crypto = require('crypto');
const { verifyTotp, newSecret, otpauthUrl } = require('../../utils/totp');

const issueAdminToken = (admin) =>
  jwt.sign(
    // pv = password version: changing the password invalidates older tokens
    { adminId: admin.id, role: admin.role, pv: admin.passwordChangedAt ? new Date(admin.passwordChangedAt).getTime() : 0 },
    process.env.ADMIN_JWT_SECRET || process.env.JWT_ACCESS_SECRET,
    { expiresIn: '8h' }
  );

// POST /admin/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const admin = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (!admin || !admin.isActive || admin.status === 'revoked') return res_.error(res, 'Invalid credentials', 401);

    const valid = (await verifyPassword(password, admin.passwordHash)).ok;
    if (!valid) return res_.error(res, 'Invalid credentials', 401);

    // 2-factor: the 6-digit Authenticator code is required once enabled
    if (admin.twoFactorEnabled) {
      const { otp } = req.body;
      if (!otp) return res_.error(res, 'Enter the 6-digit code from your authenticator app', 401, { code: 'OTP_REQUIRED' });
      if (!verifyTotp(decryptSecret(admin.twoFactorSecret), otp)) {
        return res_.error(res, 'Wrong authenticator code', 401, { code: 'OTP_INVALID' });
      }
    }

    await prisma.adminUser.update({
      where: { id: admin.id },
      data:  { lastLoginAt: new Date() },
    });

    const token = issueAdminToken(admin);
    return res_.success(res, {
      token,
      admin: {
        id:        admin.id,
        email:     admin.email,
        firstName: admin.firstName,
        lastName:  admin.lastName,
        role:      admin.role,
        avatarUrl: admin.avatarUrl,
      },
    }, 'Login successful');
  } catch (e) { next(e); }
};

// GET /admin/auth/me
const me = async (req, res, next) => {
  try {
    const admin = await prisma.adminUser.findUnique({
      where: { id: req.admin.id },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, avatarUrl: true, lastLoginAt: true, createdAt: true, twoFactorEnabled: true },
    });
    return res_.success(res, admin);
  } catch (e) { next(e); }
};

// POST /admin/auth/change-password
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof newPassword !== 'string' || newPassword.length < 10 ||
        !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res_.error(res, 'New password: at least 10 characters, one capital letter and one number', 422);
    }
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin.id } });
    const valid = (await verifyPassword(currentPassword, admin.passwordHash)).ok;
    if (!valid) return res_.error(res, 'Current password incorrect', 400);

    const hash = await hashPassword(newPassword);
    // Older tokens (other browsers, a stolen token) stop working
    const changedAt = new Date();
    await prisma.adminUser.update({ where: { id: req.admin.id }, data: { passwordHash: hash, passwordChangedAt: changedAt } });
    return res_.success(res, { token: issueAdminToken({ ...req.admin, passwordChangedAt: changedAt }) },
      'Password changed — other devices are logged out');
  } catch (e) { next(e); }
};

// ── 2-factor (TOTP) ───────────────────────────────────────
// Secret is stored encrypted (AES-256-GCM) — a DB leak alone can't mint codes
const _key = () => crypto.createHash('sha256')
  .update(String(process.env.ADMIN_2FA_KEY || process.env.ADMIN_JWT_SECRET || process.env.JWT_ACCESS_SECRET)).digest();
const encryptSecret = (plain) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', _key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
};
const decryptSecret = (packed) => {
  try {
    const [iv, tag, enc] = String(packed).split('.').map(x => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', _key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
};

// POST /admin/auth/2fa/setup → new secret (not active until confirmed)
const setup2fa = async (req, res, next) => {
  try {
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin.id } });
    if (admin.twoFactorEnabled) return res_.error(res, '2-factor login is already on', 409);
    const secret = newSecret();
    await prisma.adminUser.update({ where: { id: admin.id }, data: { twoFactorSecret: encryptSecret(secret) } });
    return res_.success(res, { secret, otpauthUrl: otpauthUrl(secret, admin.email) },
      'Add this key to Google Authenticator, then enter the 6-digit code');
  } catch (e) { next(e); }
};

// POST /admin/auth/2fa/enable { otp }
const enable2fa = async (req, res, next) => {
  try {
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin.id } });
    if (!admin.twoFactorSecret) return res_.error(res, 'Start the setup first', 400);
    if (!verifyTotp(decryptSecret(admin.twoFactorSecret), req.body.otp)) {
      return res_.error(res, 'Wrong code — check the time on your phone and try again', 400);
    }
    await prisma.adminUser.update({ where: { id: admin.id }, data: { twoFactorEnabled: true } });
    return res_.success(res, { enabled: true }, '2-factor login is ON');
  } catch (e) { next(e); }
};

// POST /admin/auth/2fa/disable { password, otp }
const disable2fa = async (req, res, next) => {
  try {
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin.id } });
    if (!admin.twoFactorEnabled) return res_.success(res, { enabled: false }, '2-factor login is off');
    const okPw = (await verifyPassword(String(req.body.password || ''), admin.passwordHash)).ok;
    if (!okPw || !verifyTotp(decryptSecret(admin.twoFactorSecret), req.body.otp)) {
      return res_.error(res, 'Password or code is wrong', 400);
    }
    await prisma.adminUser.update({ where: { id: admin.id }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
    return res_.success(res, { enabled: false }, '2-factor login is OFF');
  } catch (e) { next(e); }
};

module.exports = { login, me, changePassword, setup2fa, enable2fa, disable2fa };
