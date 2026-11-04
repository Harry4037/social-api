'use strict';
const cron = require('node-cron');
const prisma = require('../config/db');
const notifSvc = require('../services/notification.service');
const logger = require('../config/logger');

const xpCtrl = require('../controllers/xp.controller');
const strikeCtrl = require('../controllers/strike.controller');
const sessCtrl = require('../controllers/session.controller');


// Every job runs on ONE server per tick, even with several API instances
// (job_runs table, see jobLock.js). Names are stable: same code order on
// every server.
const { runOnce, pruneJobRuns } = require('./jobLock');
let _jobNo = 0;
const lockedSchedule = (expr, fn, opts) => {
  const name = `job${++_jobNo}@${expr}`;
  return cron.schedule(expr, () => runOnce(name, fn), opts);
};

// Missed sessions: ONE rule = sessCtrl.markIncomplete (every 15 min below).
// (An older job here also charged 2 tokens and could push tokens below 0.)

// Proof reminder: ONCE, right after the session ends, to everyone who can
// upload (was every 30 min for 8 h, starting mid-workout, host only).
const proofReminders = lockedSchedule('*/30 * * * *', async () => {
  try {
    const r = await sessCtrl.sendProofReminders();
    if (r.sent) logger.info(`Sent ${r.sent} proof reminders`);
  } catch (e) {
    logger.error('proofReminders cron error: ' + e.message);
  }
}, { scheduled: false });

const startJobs = () => {
  proofReminders.start();

  // 0. Invites nobody answered before the start time → expired/cancelled (every 5 min)
  lockedSchedule('*/5 * * * *', async () => {
    try {
      const r = await sessCtrl.expireUnansweredInvites();
      if (r?.expired > 0)
        logger.info(`[CRON] expireUnansweredInvites: ${r.expired} invites expired, ${r.cancelled} sessions cancelled`);
    } catch (e) { logger.error('[CRON] expireUnansweredInvites: ' + e.message); }
  });

  // 1. Mark missed sessions (every 15 min)
  // (Check if you already have this — if yes, update it to use xpCtrl)
  lockedSchedule('*/15 * * * *', async () => {
    try {
      const r = await sessCtrl.markIncomplete();
      if (r?.marked > 0)
        logger.info(`[CRON] markIncomplete: ${r.marked} sessions marked missed`);
    } catch (e) { logger.error('[CRON] markIncomplete: ' + e.message); }
  });

  // 2. Trust score decay — daily 2 AM IST (8:30 PM UTC)
  lockedSchedule('30 20 * * *', async () => {
    try {
      const r = await xpCtrl.runTrustDecay();
      logger.info(`[CRON] trustDecay: ${r.decayed}/${r.processed} users decayed`);
    } catch (e) { logger.error('[CRON] trustDecay: ' + e.message); }
  });

  // 3. Weekly XP reset — Saturday 11:59 PM IST (6:29 PM UTC)
  lockedSchedule('29 18 * * 6', async () => {
    try {
      const r = await xpCtrl.resetWeeklyXP();
      logger.info(`[CRON] weeklyXpReset: ${r.reset} users reset`);
    } catch (e) { logger.error('[CRON] weeklyXpReset: ' + e.message); }
  });

  // 4. Monthly XP reset — last day of month 11:59 PM IST
  lockedSchedule('29 18 * * *', async () => {
    try {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (tomorrow.getDate() === 1) {
        const r = await xpCtrl.resetMonthlyXP();
        logger.info(`[CRON] monthlyXpReset: ${r.reset} users reset`);
      }
    } catch (e) { logger.error('[CRON] monthlyXpReset: ' + e.message); }
  });

  // 5. Pro token refill — 1st of month
  lockedSchedule('31 18 28-31 * *', async () => {
    try {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (tomorrow.getDate() === 1) {
        const r = await xpCtrl.refillProTokens();
        logger.info(`[CRON] proTokenRefill: ${r.refilled} Pro users refilled`);
      }
    } catch (e) { logger.error('[CRON] proTokenRefill: ' + e.message); }
  });

  // 6. Expire Strike 2s — every 30 min
  lockedSchedule('*/30 * * * *', async () => {
    try {
      const r = await strikeCtrl.expireStrikes();
      if (r?.deleted > 0)
        logger.info(`[CRON] expireStrikes: ${r.deleted} deleted`);
    } catch (e) { logger.error('[CRON] expireStrikes: ' + e.message); }
  });

  // 7. Strike streak warnings — daily 9 PM IST (3:30 PM UTC)
  lockedSchedule('30 15 * * *', async () => {
    try {
      const r = await strikeCtrl.sendStreakWarnings();
      if (r?.warned > 0)
        logger.info(`[CRON] streakWarnings: ${r.warned} matches warned`);
    } catch (e) { logger.error('[CRON] streakWarnings: ' + e.message); }
  });

  // 6c. Old job_runs rows — daily
  lockedSchedule('23 23 * * *', () => pruneJobRuns());

  // 6a. Expired Idempotency-Keys — hourly
  lockedSchedule('17 * * * *', async () => {
    try {
      const r = await require('../middleware/idempotency').pruneIdempotencyKeys();
      if (r.deleted) logger.info(`[CRON] pruneIdempotencyKeys: ${r.deleted} deleted`);
    } catch (e) { logger.error('[CRON] pruneIdempotencyKeys: ' + e.message); }
  });

  // 6b. Delete old notifications — daily 4:10 AM IST
  lockedSchedule('40 22 * * *', async () => {
    try {
      const r = await require('../services/notification.service').pruneOldNotifications();
      logger.info(`[CRON] pruneOldNotifications: ${r.deleted} deleted`);
    } catch (e) { logger.error('[CRON] pruneOldNotifications: ' + e.message); }
  });

  // 7a. Weekly recap push — Sunday 7 PM IST (1:30 PM UTC)
  lockedSchedule('30 13 * * 0', async () => {
    try {
      await require('../services/engagement.service').sendWeeklyRecap();
    } catch (e) { logger.error('[CRON] weeklyRecap: ' + e.message); }
  });

  // 7b. Break strike streaks that missed a day (Pro: streak freeze) — 00:05 IST
  lockedSchedule('35 18 * * *', async () => {
    try {
      const r = await strikeCtrl.breakStrikeStreaks();
      logger.info(`[CRON] breakStrikeStreaks: ${r.broken} broken, ${r.frozen} frozen`);
    } catch (e) { logger.error('[CRON] breakStrikeStreaks: ' + e.message); }
  });

  // 8. Break expired Flash streaks — every hour
  lockedSchedule('0 * * * *', async () => {
    try {
      const flashCtrl = require('../controllers/flash_streak.controller');
      const r = await flashCtrl.breakExpiredStreaks();
      if (r?.broken > 0)
        logger.info(`[CRON] flashStreakBreak: ${r.broken} streaks reset`);
    } catch (e) { logger.error('[CRON] flashStreakBreak: ' + e.message); }
  });

  // 9. Auto delete chat messages — every 10 min
  // Only messages sent while the chat was in 24h mode have expiresAt.
  // Normal-mode chats (default) keep their messages.
  lockedSchedule('*/10 * * * *', async () => {
    try {
      const deleted = await prisma.message.deleteMany({
        where: { expiresAt: { not: null, lt: new Date() } },
      });
      if (deleted.count > 0)
        logger.info(`[CRON] autoDeleteMessages: ${deleted.count} expired messages deleted`);
    } catch (e) { logger.error('[CRON] autoDeleteMessages: ' + e.message); }
  });

  // 10. Buddy proof confirmation — every 5 min
  // Reminders at 1h and 1h45m; at 2h the session closes:
  // uploader gets XP, confirmer loses their XP + trust -2.
  lockedSchedule('*/5 * * * *', async () => {
    try {
      const r = await sessCtrl.processProofConfirmations();
      if (r.reminded || r.closed)
        logger.info(`[CRON] proofConfirm: ${r.reminded} reminded, ${r.closed} auto-closed`);
    } catch (e) { logger.error('[CRON] proofConfirm: ' + e.message); }
  });

  // 11. "Session in 1 hour" reminder — every 5 min
  lockedSchedule('*/5 * * * *', async () => {
    try {
      const r = await require('../services/engagement.service').sendSessionStartReminders();
      if (r.sent) logger.info(`[CRON] sessionStartReminders: ${r.sent} sent`);
    } catch (e) { logger.error('[CRON] sessionStartReminders: ' + e.message); }
  });

  // 12. Win-back nudges (inactive 3/7/14 days) — daily 7:00 PM IST (13:30 UTC)
  lockedSchedule('30 13 * * *', async () => {
    try {
      await require('../services/engagement.service').sendWinbackNudges();
    } catch (e) { logger.error('[CRON] winback: ' + e.message); }
  });

  // 13. Clean old gym check-ins — daily 3:00 AM IST (21:30 UTC)
  lockedSchedule('30 21 * * *', async () => {
    try {
      const r = await require('../controllers/gym.controller').cleanupCheckins();
      if (r.deleted) logger.info(`[CRON] gymCheckins cleanup: ${r.deleted}`);
    } catch (e) { logger.error('[CRON] gymCheckins cleanup: ' + e.message); }
  });

  logger.info('Background jobs started');
};

const stopJobs = () => {
  proofReminders.stop();
};

module.exports = { startJobs, stopJobs };
