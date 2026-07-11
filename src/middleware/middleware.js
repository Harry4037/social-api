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
    return error(res, 'Validation failed', 422, errors);
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

  const statusCode = err.statusCode || 500;
  const message    = process.env.NODE_ENV === 'production' && statusCode === 500
    ? 'Internal server error'
    : err.message;

  return error(res, message, statusCode);
};

// ── Rate Limiters ─────────────────────────────────────────
const defaultLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      Number(process.env.RATE_LIMIT_MAX)        || 100,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down' },
});

const authLimiter = rateLimit({
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

module.exports = { validate, errorHandler, defaultLimiter, authLimiter, swipeLimiter };
