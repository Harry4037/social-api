'use strict';
// ─────────────────────────────────────────────────────────
//  Idempotency-Key  (same idea as Stripe / Razorpay APIs)
//
//  Phones on Indian mobile data time out a lot. When that happens the app
//  re-sends the SAME action with the SAME `Idempotency-Key` header. Here:
//   • first request runs normally; its answer is saved for 24 h
//   • a retry with the same key gets the saved answer (header
//     `Idempotent-Replayed: true`) — nothing runs twice (no double
//     message, double token charge, double session, double payment)
//   • a copy that arrives while the first is still running → 409
//     IDEMPOTENCY_IN_PROGRESS (the app waits a moment and retries)
//   • same key with a different body → 422 IDEMPOTENCY_KEY_REUSED
//
//  Keys are per user (per IP before login). Only answers that will not
//  change on retry are saved: 2xx and business 4xx. 401 / 403 / 408 / 429 /
//  5xx are forgotten so the retry really runs again (e.g. after a token
//  refresh). No header = old behaviour, so old app versions keep working.
//  Stored in MySQL (works with any number of API servers, no Redis needed).
// ─────────────────────────────────────────────────────────
const crypto = require('crypto');
const prisma = require('../config/db');
const { verifyAccess } = require('../utils/jwt');

const TTL_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 60 * 1000;          // "in progress" for > 60 s = crashed, take over
const MAX_BODY = 64 * 1024;          // bigger answers are not saved
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,100}$/;
const RETRYABLE = new Set([401, 403, 408, 425, 429]);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP = [/\/auth\/(login|refresh|logout)$/, /\/admin\//];

const scopeOf = (req) => {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try { const p = verifyAccess(h.slice(7)); if (p?.sub) return `u:${p.sub}`; } catch (_) {}
    return null; // bad token → authenticate() will answer 401; nothing to save
  }
  return `ip:${req.ip}`;
};

const hashOf = (req) => crypto.createHash('sha256')
  .update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`).digest('hex');

const replay = (res, row) => {
  res.set('Idempotent-Replayed', 'true');
  return res.status(row.responseCode).json(row.responseBody);
};

const idempotency = async (req, res, next) => {
  const key = req.get('Idempotency-Key');
  if (!key || !MUTATING.has(req.method) || SKIP.some(r => r.test(req.path))) return next();
  if (!KEY_RE.test(key)) {
    return res.status(400).json({ success: false, message: 'Invalid Idempotency-Key (8–100 letters, digits, - _ : .)' });
  }
  const scope = scopeOf(req);
  if (!scope) return next();
  const requestHash = hashOf(req);
  const now = new Date();

  let row;
  try {
    row = await prisma.idempotencyKey.create({ data: {
      scope, key, requestHash, method: req.method, path: req.originalUrl.slice(0, 191),
      status: 'in_progress', expiresAt: new Date(now.getTime() + TTL_MS),
    } });
  } catch (e) {
    if (e.code !== 'P2002') return next(e);
    const old = await prisma.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
    if (!old) return next(); // just deleted (retryable failure) → run normally
    if (old.requestHash !== requestHash) {
      return res.status(422).json({ success: false, message: 'This Idempotency-Key was already used for a different request',
        errors: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    }
    if (old.status === 'done') return replay(res, old);
    // still running — or crashed long ago: take it over
    const took = await prisma.idempotencyKey.updateMany({
      where: { id: old.id, status: 'in_progress', updatedAt: { lt: new Date(now.getTime() - STALE_MS) } },
      data: { updatedAt: now },
    });
    if (!took.count) {
      res.set('Retry-After', '1');
      return res.status(409).json({ success: false, message: 'Still working on this — try again in a moment',
        errors: { code: 'IDEMPOTENCY_IN_PROGRESS' } });
    }
    row = old;
  }

  // Remember the JSON answer, save it when the response is finished
  let body;
  const json = res.json.bind(res);
  res.json = (b) => { body = b; return json(b); };
  res.on('finish', () => {
    const code = res.statusCode;
    const keep = body !== undefined && code < 500 && !RETRYABLE.has(code) &&
      Buffer.byteLength(JSON.stringify(body)) <= MAX_BODY;
    const op = keep
      ? prisma.idempotencyKey.update({ where: { id: row.id }, data: { status: 'done', responseCode: code, responseBody: body } })
      : prisma.idempotencyKey.delete({ where: { id: row.id } });
    op.catch(() => {});
  });
  next();
};

// CRON (hourly): drop expired keys
const pruneIdempotencyKeys = async () => {
  const r = await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { deleted: r.count };
};

module.exports = { idempotency, pruneIdempotencyKeys };
