'use strict';
const { hashPassword, verifyPassword } = require('../utils/password');
const { v4: uuid } = require('uuid');
const prisma     = require('../config/db');
const { withUserCounts, withUserCount } = require('../utils/relationCounts');
const jwtUtils   = require('../utils/jwt');
const { formatUser, PHOTOS_SELECT } = require('../utils/formatUser');
const res_       = require('../utils/response');
const logger     = require('../config/logger');

// POST /auth/register
const register = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res_.error(res, 'Email already registered', 409);

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        id:        uuid(),
        email:     email.toLowerCase(),
        passwordHash,
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        phone:     phone?.trim() || null,
        chatTokens: 20,
      },
      include: { photos: PHOTOS_SELECT },
    });

    const tokens = jwtUtils.issueTokenPair(user);
    await prisma.refreshToken.create({
      data: {
        id:        uuid(),
        userId:    user.id,
        token:     tokens.refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    logger.info(`User registered: ${user.email}`);
    // Email verification code (never blocks sign-up if mail is down)
    await _sendVerifyCode(user).catch(e => logger.warn('[verify-email] ' + e.message));

    return res_.created(res, { user: formatUser(user), ...tokens }, 'Registration successful');
  } catch (e) { next(e); }
};

// POST /auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where:   { email: email.toLowerCase() },
      include: { photos: PHOTOS_SELECT },
    });
    if (!user || user.deletedAt) return res_.error(res, 'Invalid email or password', 401);

    // Password first — otherwise "Account banned" tells anyone the email exists
    const pw = await verifyPassword(password, user.passwordHash);
    if (!pw.ok) return res_.error(res, 'Invalid email or password', 401);
    // Old bcrypt hash → quietly upgrade to scrypt (no one has to reset)
    if (pw.needsRehash) {
      hashPassword(password)
        .then(h => prisma.user.update({ where: { id: user.id }, data: { passwordHash: h } }))
        .catch(() => {});
    }
    if (user.isBanned || user.status === 'BANNED') return res_.error(res, 'Account banned', 403);

    const tokens = jwtUtils.issueTokenPair(user);
    await prisma.$transaction([
      prisma.refreshToken.create({
        data: {
          id:        uuid(),
          userId:    user.id,
          token:     tokens.refreshToken,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data:  { loginCount: { increment: 1 }, lastLoginAt: new Date(), lastActiveAt: new Date() },
      }),
    ]);

    logger.info(`User logged in: ${user.email}`);
    return res_.success(res, { user: formatUser(await withUserCount(user)), ...tokens }, 'Login successful');
  } catch (e) { next(e); }
};

// POST /auth/refresh
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res_.error(res, 'Refresh token required', 400);

    let payload;
    try { payload = jwtUtils.verifyRefresh(refreshToken); }
    catch { return res_.error(res, 'Invalid or expired refresh token', 401); }

    const stored = await prisma.refreshToken.findFirst({
      where: { token: refreshToken, userId: payload.sub },
    });
    if (!stored || stored.expiresAt < new Date()) {
      return res_.error(res, 'Refresh token expired — please login again', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.isBanned || user.deletedAt) return res_.error(res, 'Account not accessible', 403);

    const tokens = jwtUtils.issueTokenPair(user);
    await prisma.$transaction([
      prisma.refreshToken.delete({ where: { id: stored.id } }),
      prisma.refreshToken.create({
        data: {
          id:        uuid(),
          userId:    user.id,
          token:     tokens.refreshToken,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    return res_.success(res, tokens, 'Tokens refreshed');
  } catch (e) { next(e); }
};

// POST /auth/logout
const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    return res_.success(res, null, 'Logged out');
  } catch (e) { next(e); }
};

// GET /auth/me
const me = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where:   { id: req.user.id },
      include: { photos: PHOTOS_SELECT },
    });
    if (!user) return res_.error(res, 'User not found', 404);
    return res_.success(res, formatUser(await withUserCount(user)));
  } catch (e) { next(e); }
};

// ─────────────────────────────────────────────────────────
//  FORGOT PASSWORD — 6-digit email OTP
//  POST /auth/forgot-password { email }
//  POST /auth/verify-otp      { email, otp }
//  POST /auth/reset-password  { email, otp, newPassword }
// ─────────────────────────────────────────────────────────
const crypto  = require('crypto');
const mailSvc = require('../services/mail.service');
const OTP_TTL_MS   = 10 * 60 * 1000;
const OTP_MAX_TRIES = 5;
const hashOtp = (otp, userId) =>
  crypto.createHash('sha256').update(`${otp}:${userId}:${process.env.JWT_ACCESS_SECRET || ''}`).digest('hex');

// Latest usable reset for this email (or null)
const _activeReset = async (email) => {
  const user = await prisma.user.findUnique({
    where: { email: String(email || '').toLowerCase().trim() },
    select: { id: true, firstName: true, email: true, isBanned: true },
  });
  if (!user || user.isBanned) return { user: null, reset: null };
  const reset = await prisma.passwordReset.findFirst({
    where: { userId: user.id, purpose: 'reset', usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  return { user, reset };
};

// Check OTP; counts a failed attempt. Returns error message or null.
const _checkOtp = async (reset, user, otp) => {
  if (!reset) return 'Code expired. Please request a new one.';
  // Claim one attempt atomically BEFORE comparing — parallel guesses can no
  // longer slip past the 5-attempt limit
  const claim = await prisma.passwordReset.updateMany({
    where: { id: reset.id, attempts: { lt: OTP_MAX_TRIES } },
    data:  { attempts: { increment: 1 } },
  });
  if (claim.count === 0) return 'Too many attempts. Please request a new code.';
  if (hashOtp(String(otp || '').trim(), user.id) !== reset.otpHash) {
    return 'Incorrect code. Please try again.';
  }
  return null;
};

const forgotPassword = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const user = await prisma.user.findUnique({
      where: { email }, select: { id: true, firstName: true, isBanned: true, deletedAt: true },
    });
    // Same response whether or not the account exists (no email enumeration)
    const ok = () => res_.success(res, null, 'If an account exists, a 6-digit code has been sent to your email.');
    if (!user || user.isBanned || user.deletedAt) return ok();

    // Max one code per minute
    const recent = await prisma.passwordReset.findFirst({
      where: { userId: user.id, purpose: 'reset', createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
    });
    // A code was sent less than a minute ago → don't send another, but answer
    // exactly like for an unknown email (a 429 here revealed the account exists)
    if (recent) return ok();

    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await prisma.passwordReset.updateMany({
      where: { userId: user.id, purpose: 'reset', usedAt: null }, data: { usedAt: new Date() }, // invalidate older codes
    });
    await prisma.passwordReset.create({
      data: {
        id: uuid(), userId: user.id, otpHash: hashOtp(otp, user.id), purpose: 'reset',
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    await mailSvc.sendPasswordResetOtp(email, user.firstName, otp);
    return ok();
  } catch (e) { next(e); }
};

const verifyOtp = async (req, res, next) => {
  try {
    const { user, reset } = await _activeReset(req.body.email);
    if (!user) return res_.error(res, 'Incorrect code. Please try again.', 400);
    const err = await _checkOtp(reset, user, req.body.otp);
    if (err) return res_.error(res, err, 400);
    return res_.success(res, { valid: true }, 'Code verified');
  } catch (e) { next(e); }
};

const resetPassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 8) {
      return res_.error(res, 'Password must be at least 8 characters', 422);
    }
    const { user, reset } = await _activeReset(req.body.email);
    if (!user) return res_.error(res, 'Incorrect code. Please try again.', 400);
    const err = await _checkOtp(reset, user, req.body.otp);
    if (err) return res_.error(res, err, 400);

    const passwordHash = await hashPassword(String(newPassword));
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      prisma.refreshToken.deleteMany({ where: { userId: user.id } }), // log out other devices
    ]);
    return res_.success(res, null, 'Password updated. Please log in with your new password.');
  } catch (e) { next(e); }
};

// ── Email verification ────────────────────────────────────
// POST /auth/email/send-code  (logged in) — max 1 per minute
// POST /auth/email/verify { otp }
const _sendVerifyCode = async (user) => {
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await prisma.passwordReset.updateMany({
    where: { userId: user.id, purpose: 'verify_email', usedAt: null }, data: { usedAt: new Date() },
  });
  await prisma.passwordReset.create({
    data: {
      id: uuid(), userId: user.id, purpose: 'verify_email', otpHash: hashOtp(otp, user.id),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min
    },
  });
  await mailSvc.sendEmailVerificationCode(user.email, user.firstName, otp);
};

const sendEmailCode = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }, select: { id: true, email: true, firstName: true, emailVerified: true },
    });
    if (user.emailVerified) return res_.success(res, { alreadyVerified: true }, 'Email already verified');
    const recent = await prisma.passwordReset.findFirst({
      where: { userId: user.id, purpose: 'verify_email', createdAt: { gt: new Date(Date.now() - 60 * 1000) } },
    });
    if (recent) return res_.error(res, 'Please wait a minute before asking for another code', 429);
    await _sendVerifyCode(user);
    return res_.success(res, null, `Code sent to ${user.email}`);
  } catch (e) { next(e); }
};

const verifyEmail = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }, select: { id: true, emailVerified: true },
    });
    if (user.emailVerified) return res_.success(res, { verified: true }, 'Email already verified');
    const code = await prisma.passwordReset.findFirst({
      where: { userId: user.id, purpose: 'verify_email', usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const err = await _checkOtp(code, user, req.body.otp);
    if (err) return res_.error(res, err, 400);
    await prisma.$transaction([
      prisma.passwordReset.update({ where: { id: code.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } }),
    ]);
    // Already finished a workout? Pay the pending referral bonus now.
    await require('./referral.controller').rewardReferralIfEarned(user.id);
    return res_.success(res, { verified: true }, 'Email verified ✅');
  } catch (e) { next(e); }
};

module.exports = {
  sendEmailCode,
  verifyEmail,
  forgotPassword,
  verifyOtp,
  resetPassword, register, login, refresh, logout, me };
