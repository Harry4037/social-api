'use strict';
// ─────────────────────────────────────────────────────────
//  Password hashing — Node's built-in scrypt.
//
//  Why not bcryptjs (cost 12)? It is pure JavaScript and runs on the main
//  thread: in the 1000-user load test 30 parallel sign-ups took ~8 s each
//  and every other request (chat, discover…) froze meanwhile. scrypt runs in
//  libuv's thread pool, so the server keeps answering everyone else.
//
//  Format: scrypt$N$r$p$saltB64$hashB64.  Old bcrypt hashes ($2a/$2b) still
//  verify; verifyPassword says needsRehash so login can upgrade them.
// ─────────────────────────────────────────────────────────
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const N = 16384, R = 8, P = 1, KEYLEN = 64; // ~16 MB, ~50 ms per hash
const MAXMEM = 64 * 1024 * 1024;

const scrypt = (pw, salt, n, r, p) => new Promise((resolve, reject) =>
  crypto.scrypt(pw, salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (e, k) => (e ? reject(e) : resolve(k))));

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
};

/** → { ok, needsRehash } — never throws */
const verifyPassword = async (password, stored) => {
  try {
    if (typeof password !== 'string' || typeof stored !== 'string') return { ok: false, needsRehash: false };
    if (stored.startsWith('$2')) {
      const ok = await bcrypt.compare(password, stored);
      return { ok, needsRehash: ok };
    }
    const [tag, n, r, p, saltB64, keyB64] = stored.split('$');
    if (tag !== 'scrypt' || !keyB64) return { ok: false, needsRehash: false };
    const expected = Buffer.from(keyB64, 'base64');
    const got = await scrypt(password, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
    const ok = got.length === expected.length && crypto.timingSafeEqual(got, expected);
    return { ok, needsRehash: ok && Number(n) < N };
  } catch {
    return { ok: false, needsRehash: false };
  }
};

module.exports = { hashPassword, verifyPassword };
