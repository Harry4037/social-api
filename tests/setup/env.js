'use strict';
// Runs before every test file (jest "setupFiles").
//
// SAFETY: tests wipe tables. They only ever run against DATABASE_URL_TEST,
// and refuse to start unless that database name contains "test".
process.env.NODE_ENV = 'test';

const url = process.env.DATABASE_URL_TEST;
if (!url) {
  throw new Error(
    'DATABASE_URL_TEST is not set.\n' +
    'Create an empty database (e.g. seshlly_test), run\n' +
    '  DATABASE_URL=$DATABASE_URL_TEST npx prisma db push\n' +
    'then: DATABASE_URL_TEST=mysql://user:pass@localhost:3306/seshlly_test npm test'
  );
}
const dbName = new URL(url).pathname.slice(1);
if (!/test/i.test(dbName)) {
  throw new Error(`Refusing to run tests: database "${dbName}" does not look like a test database`);
}
process.env.DATABASE_URL = url; // dotenv never overrides an existing value

process.env.JWT_ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET_TEST  || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET_TEST || 'test-refresh-secret';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.CLOUDINARY_CLOUD_NAME = 'demo'; // test media URLs live under /demo/
process.env.RATE_LIMIT_MAX      = '100000';
process.env.LEADERBOARD_CACHE_MS = process.env.LEADERBOARD_CACHE_MS || '0'; // fresh data between test steps
// External services stay off in tests
delete process.env.HIVE_API_KEY;
delete process.env.GOOGLE_MAPS_API_KEY;
delete process.env.SMTP_HOST;
delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
