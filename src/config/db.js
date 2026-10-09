'use strict';
const { PrismaClient } = require('@prisma/client');

// Railway MySQL: connection_limit in DATABASE_URL handles pooling
// PrismaClient is singleton — do NOT instantiate per-request
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['warn', 'error']   // remove 'query' in production — very noisy
    : ['warn', 'error'],
  errorFormat: 'minimal',
});

// Avoid multiple instances during hot-reload in development
if (process.env.NODE_ENV !== 'production') {
  global._prisma = global._prisma || prisma;
}

module.exports = process.env.NODE_ENV !== 'production' ? global._prisma : prisma;
