'use strict';
const { PrismaClient } = require('@prisma/client');

// Railway MySQL: connection_limit in DATABASE_URL handles pooling
// PrismaClient is singleton — do NOT instantiate per-request
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['warn', 'error']   // remove 'query' in production — very noisy
    : ['warn', 'error'],
  errorFormat: 'minimal',
  // Load test (1000 users): under a burst the default 2 s wait for a pooled
  // connection made match / message writes fail with "Unable to start a
  // transaction in the given time". Wait longer instead of failing.
  transactionOptions: {
    maxWait: Number(process.env.DB_TX_MAX_WAIT_MS) || 10000,
    timeout: Number(process.env.DB_TX_TIMEOUT_MS) || 15000,
  },
});

// Avoid multiple instances during hot-reload in development
if (process.env.NODE_ENV !== 'production') {
  global._prisma = global._prisma || prisma;
}

module.exports = process.env.NODE_ENV !== 'production' ? global._prisma : prisma;
