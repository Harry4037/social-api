'use strict';
// ─────────────────────────────────────────────────────────
//  One run per cron tick, even with several API servers.
//
//  node-cron runs inside every API process. With 2+ servers each job ran
//  on each of them (weekly recap / streak warnings / win-back sent twice).
//  Before running, a server inserts (job, minute) into `job_runs`; the
//  unique key lets only the first one win. Works with MySQL only — no
//  Redis needed. Rows older than 7 days are pruned.
// ─────────────────────────────────────────────────────────
const prisma = require('../config/db');
const logger = require('../config/logger');

const slotOf = (d) => d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM

/** → true if this server ran the job for this minute */
const runOnce = async (name, fn, at = new Date()) => {
  try {
    await prisma.jobRun.create({ data: { name: name.slice(0, 100), slot: slotOf(at) } });
  } catch (e) {
    if (e.code === 'P2002') return false; // another server has it
    logger.error(`[jobLock] ${name}: ${e.message}`);
    return false;
  }
  try { await fn(); } catch (e) { logger.error(`[CRON] ${name}: ${e.message}`); }
  return true;
};

const pruneJobRuns = async (now = new Date()) => {
  const r = await prisma.jobRun.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * 864e5) } } });
  return { deleted: r.count };
};

module.exports = { runOnce, pruneJobRuns };
