'use strict';
const { checkSecrets, assertSecrets } = require('../../src/config/secrets');

const strong = (c) => c.repeat(40);
const good = { JWT_ACCESS_SECRET: strong('a'), JWT_REFRESH_SECRET: strong('b'), ADMIN_JWT_SECRET: strong('c'), DATABASE_URL: 'mysql://x' };

test('good config passes', () => expect(checkSecrets(good)).toEqual([]));
test('missing / short / placeholder / reused secrets are reported', () => {
  expect(checkSecrets({ ...good, ADMIN_JWT_SECRET: undefined })).toContain('ADMIN_JWT_SECRET is not set');
  expect(checkSecrets({ ...good, JWT_ACCESS_SECRET: 'short' })[0]).toMatch(/too short/);
  expect(checkSecrets({ ...good, JWT_REFRESH_SECRET: good.JWT_ACCESS_SECRET }).join()).toMatch(/must be different/);
  expect(checkSecrets({ ...good, ADMIN_JWT_SECRET: good.JWT_ACCESS_SECRET }).join()).toMatch(/ADMIN_JWT_SECRET must be different/);
});
test('only blocks start in production', () => {
  const quiet = { error: () => {} };
  expect(assertSecrets(quiet, { NODE_ENV: 'development' })).toBe(true);
  expect(assertSecrets(quiet, { NODE_ENV: 'production' })).toBe(false);
  expect(assertSecrets(quiet, { ...good, NODE_ENV: 'production' })).toBe(true);
});
