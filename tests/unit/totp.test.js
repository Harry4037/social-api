'use strict';
const { totp, verifyTotp, base32Encode, base32Decode, newSecret, otpauthUrl } = require('../../src/utils/totp');

// RFC 6238 Appendix B (SHA-1 secret "12345678901234567890")
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test.each([
  [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
  [1234567890, '89005924'], [2000000000, '69279037'],
])('RFC 6238 vector t=%i', (t, code8) => {
  expect(totp(RFC_SECRET, { time: t * 1000, digits: 8 })).toBe(code8);
});

test('6-digit codes, ±1 step allowed, others rejected', () => {
  const now = 1_800_000_000_000;
  const code = totp(RFC_SECRET, { time: now });
  expect(code).toMatch(/^\d{6}$/);
  expect(verifyTotp(RFC_SECRET, code, { time: now + 25_000 })).toBe(true);
  expect(verifyTotp(RFC_SECRET, code, { time: now + 95_000 })).toBe(false);
  expect(verifyTotp(RFC_SECRET, '000000x', { time: now })).toBe(false);
  expect(verifyTotp(RFC_SECRET, '', { time: now })).toBe(false);
});

test('base32 round trip + new secrets are 160-bit', () => {
  const b = Buffer.from('hello world!');
  expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  expect(base32Decode(newSecret()).length).toBe(20);
});

test('otpauth URL for Google Authenticator', () => {
  const u = otpauthUrl('ABC', 'admin@seshlly.com');
  expect(u).toBe('otpauth://totp/Seshlly%20Admin:admin%40seshlly.com?secret=ABC&issuer=Seshlly%20Admin&digits=6&period=30');
});
