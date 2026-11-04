'use strict';
/**
 * Safe page/limit from a query string. Bad values (NaN, negatives, huge
 * limits) used to reach Prisma and cause 500s or full-table reads.
 */
const pageParams = (query = {}, { def = 20, max = 50 } = {}) => {
  const page  = Math.max(1, Math.floor(Number(query.page)) || 1);
  const limit = Math.min(max, Math.max(1, Math.floor(Number(query.limit)) || def));
  return { page, limit, skip: (page - 1) * limit, take: limit };
};

module.exports = { pageParams };
