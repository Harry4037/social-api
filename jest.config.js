'use strict';
// Unit tests:        npm run test:unit         (no database needed)
// Integration tests: npm run test:integration  (needs DATABASE_URL_TEST — see tests/README.md)
const mapper = {};
// Optional: swap the Prisma client used by src/config/db (CI/sandbox use only)
if (process.env.TEST_PRISMA_CLIENT) {
  mapper['^(\\.{1,2}/)+(src/)?config/db(\\.js)?$'] = process.env.TEST_PRISMA_CLIENT;
}

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  moduleNameMapper: mapper,
  testTimeout: 20000,
  clearMocks: true,
};
