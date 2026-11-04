'use strict';
// ─────────────────────────────────────────────────────────
//  TOTP (RFC 6238) — the 6-digit codes of Google Authenticator,
//  Microsoft Authenticator, Authy… Used for admin 2-factor login.
//  No extra package: HMAC-SHA1 + base32 from Node's crypto.
// ─────────────────────────────────────────────────────────
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Encode = (buf) => {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

const base32Decode = (str) => {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
};

/** Code for `time` (ms). */
const totp = (secretB32, { time = Date.now(), step = 30, digits = 6 } = {}) => {
  const counter = Math.floor(time / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
};

/** Accepts the current code and the ones just before/after (clock drift). */
const verifyTotp = (secretB32, code, { time = Date.now(), window = 1 } = {}) => {
  if (!secretB32 || !/^\d{6}$/.test(String(code || ''))) return false;
  for (let w = -window; w <= window; w++) {
    const c = totp(secretB32, { time: time + w * 30000 });
    if (crypto.timingSafeEqual(Buffer.from(c), Buffer.from(String(code)))) return true;
  }
  return false;
};

const newSecret = () => base32Encode(crypto.randomBytes(20));

const otpauthUrl = (secret, account, issuer = 'Seshlly Admin') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
  `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

module.exports = { totp, verifyTotp, base32Encode, base32Decode, newSecret, otpauthUrl };
