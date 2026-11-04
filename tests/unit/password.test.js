'use strict';
// Load test (1000 sign-ups): bcryptjs cost 12 runs in pure JS on the main
// thread → 30 parallel sign-ups took 8 s each and froze every other request.
// New hashes use Node's built-in scrypt (runs off the main thread).
const bcrypt = require('bcryptjs');
const { hashPassword, verifyPassword } = require('../../src/utils/password');
const { monitorEventLoopDelay } = require('perf_hooks');

test('hash + verify round trip; wrong password fails', async () => {
  const h = await hashPassword('Seshlly@2026');
  expect(h).toMatch(/^scrypt\$/);
  expect(await verifyPassword('Seshlly@2026', h)).toEqual({ ok: true, needsRehash: false });
  expect((await verifyPassword('seshlly@2026', h)).ok).toBe(false);
});

test('same password → different hashes (random salt)', async () => {
  expect(await hashPassword('Abc12345')).not.toBe(await hashPassword('Abc12345'));
});

test('old bcrypt hashes still log in and are flagged for upgrade', async () => {
  const old = await bcrypt.hash('Passw0rd!', 4);
  expect(await verifyPassword('Passw0rd!', old)).toEqual({ ok: true, needsRehash: true });
  expect((await verifyPassword('nope', old)).ok).toBe(false);
});

test('garbage / missing hash never throws', async () => {
  expect((await verifyPassword('x', null)).ok).toBe(false);
  expect((await verifyPassword('x', 'scrypt$bad')).ok).toBe(false);
  expect((await verifyPassword(undefined, 'scrypt$1$2$3$aa$bb')).ok).toBe(false);
});

test('20 parallel hashes do not block the event loop', async () => {
  const h = monitorEventLoopDelay({ resolution: 5 }); h.enable();
  await Promise.all(Array.from({ length: 20 }, () => hashPassword('Seshlly@2026')));
  h.disable();
  expect(h.max / 1e6).toBeLessThan(150); // ms
});
