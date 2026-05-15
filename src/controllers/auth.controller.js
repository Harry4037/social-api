'use strict';
const bcrypt     = require('bcryptjs');
const { v4: uuid } = require('uuid');
const prisma     = require('../config/db');
const jwtUtils   = require('../utils/jwt');
const { formatUser } = require('../utils/formatUser');
const res_       = require('../utils/response');
const logger     = require('../config/logger');

// POST /auth/register
const register = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res_.error(res, 'Email already registered', 409);

    const passwordHash = await bcrypt.hash(password, 12);
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
      include: { _count: { select: { matchesA: true, sessionsAsUser: true } } },
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
    return res_.created(res, { user: formatUser(user), ...tokens }, 'Registration successful');
  } catch (e) { next(e); }
};

// POST /auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where:   { email: email.toLowerCase() },
      include: { _count: { select: { matchesA: true, sessionsAsUser: true } } },
    });
    if (!user) return res_.error(res, 'Invalid email or password', 401);
    if (user.isBanned) return res_.error(res, 'Account banned', 403);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res_.error(res, 'Invalid email or password', 401);

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
    return res_.success(res, { user: formatUser(user), ...tokens }, 'Login successful');
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
    if (!user || user.isBanned) return res_.error(res, 'Account not accessible', 403);

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
      include: { _count: { select: { matchesA: true, sessionsAsUser: true } } },
    });
    if (!user) return res_.error(res, 'User not found', 404);
    return res_.success(res, formatUser(user));
  } catch (e) { next(e); }
};

module.exports = { register, login, refresh, logout, me };
