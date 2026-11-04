'use strict';
const { validationResult } = require('express-validator');
const { error }            = require('../utils/response');
const logger               = require('../config/logger');
const rateLimit            = require('express-rate-limit');

// ── Validation ────────────────────────────────────────────
const validate = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const errors = result.array().map(e => ({ field: e.path, message: e.msg }));
    // The app shows `message` to the user → make it the first real reason
    // ("Must contain at least one number"), not a generic "Validation failed"
    const first = errors[0];
    const message = first && first.message && first.message !== 'Invalid value'
      ? first.message
      : `Please check ${String(first?.field || 'your input').replace(/[^a-zA-Z0-9 ]/g, ' ').trim()}`;
    return error(res, message, 422, errors);
  }
  next();
};

// ── Global Error Handler ──────────────────────────────────
const errorHandler = (err, req, res, next) => {
  logger.error({ message: err.message, stack: err.stack, path: req.path });

  if (err.code === 'P2002') {
    const field = err.meta?.target?.[0] ?? 'field';
    return error(res, `${field} already exists`, 409);
  }
  if (err.code === 'P2025') return error(res, 'Record not found', 404);
  if (err.name  === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return error(res, 'File too large (max 10 MB)', 413);
    return error(res, err.message, 400);
  }

  // Bad input that reached the database (too long, wrong type…) → 422
  if (err.code === 'P2000' || err.code === 'P2003' || err.code === 'P2006' ||
      err.name === 'PrismaClientValidationError' || err.code === 'P2023') {
    return error(res, 'Some of the data you sent is invalid', 422);
  }
  if (err.type === 'entity.too.large') return error(res, 'Request too large', 413);
  if (err.type === 'entity.parse.failed') return error(res, 'Invalid JSON', 400);

  const statusCode = err.statusCode || err.status || 500;
  // Never send raw internals (Prisma queries, stack text) for a 500,
  // whatever NODE_ENV is set to
  const message = statusCode >= 500 ? 'Internal server error' : err.message;

  return error(res, message, statusCode);
};

// ── Rate Limiters ─────────────────────────────────────────
// Limit per LOGGED-IN USER (from the JWT), not per IP.
// Per-IP limits break in India at launch: mobile networks (Jio/Airtel CGNAT),
// college & office Wi-Fi put hundreds of users behind ONE IP, so they would
// all share a single 100-request bucket. Unauthenticated calls fall back to IP.
const { verifyAccess } = require('../utils/jwt');
const userOrIpKey = (req) => {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const payload = verifyAccess(h.slice(7));
      if (payload?.sub) return `u:${payload.sub}`;
    } catch (_) { /* invalid/expired token → IP */ }
  }
  return `ip:${req.ip}`;
};

const defaultLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  // ~40 req/min per user — a normal session (discover, chat, feed, polling) fits easily
  max:      Number(process.env.RATE_LIMIT_MAX)        || 600,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { success: false, message: 'Too many requests, please slow down' },
});

// Login / OTP limits are per ACCOUNT (email) when one is given: a fake
// X-Forwarded-For header can change the IP, but not the account being attacked.
// (Also fairer in India: many users share one mobile-network IP.)
const accountOrIpKey = (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().replace(/\./g, '') : '';
  return email ? `e:${email.slice(0, 191)}` : `ip:${req.ip}`;
};

const authLimiter = rateLimit({
  keyGenerator: accountOrIpKey,
  windowMs: 15 * 60 * 1000,
  max:      Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts' },
});

const swipeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      60,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Slow down on swipes' },
});

// Uploads go to paid Cloudinary storage — cap per user
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      Number(process.env.UPLOAD_RATE_LIMIT_MAX) || 40,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { success: false, message: 'Too many uploads — try again later' },
});

module.exports = { validate, errorHandler, defaultLimiter, authLimiter, swipeLimiter, uploadLimiter };
