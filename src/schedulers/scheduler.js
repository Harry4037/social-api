'use strict';
const cron = require('node-cron');
const prisma = require('../config/db');
const notifSvc = require('../services/notification.service');
const logger = require('../config/logger');

const xpCtrl = require('../controllers/xp.controller');
const strikeCtrl = require('../controllers/strike.controller');
const sessCtrl = require('../controllers/session.controller');

const TOKEN_DEDUCT_MISSED = 2;

/**
 * Every 5 minutes: mark sessions as 'missed' if the deadline
 * has passed without proof upload, and deduct tokens.
 */
const markMissedSessions = cron.schedule('*/5 * * * *', async () => {
  try {
    const deadline = new Date(Date.now() - 8 * 60 * 60 * 1000); // 8 hours ago

    const overdue = await prisma.workoutSession.findMany({
      where: {
        status: 'scheduled',
        scheduledAt: { lte: deadline },
        proofImageUrl: null,
      },
      select: { id: true, userId: true, buddyId: true },
    });

    if (!overdue.length) return;
    logger.info(`Marking ${overdue.length} sessions as missed`);

    for (const s of overdue) {
      await prisma.$transaction([
        prisma.workoutSession.update({
          where: { id: s.id },
          data: { status: 'missed', tokensDeducted: TOKEN_DEDUCT_MISSED },
        }),
        prisma.user.update({
          where: { id: s.userId },
          data: {
            chatTokens: { decrement: TOKEN_DEDUCT_MISSED },
          },
        }),
      ]);

      await notifSvc.create({
        userId: s.userId,
        type: 'session',
        title: '😔 Session Missed',
        message: `You missed a session and ${TOKEN_DEDUCT_MISSED} chat tokens were deducted.`,
        data: { sessionId: s.id },
      });
    }
  } catch (e) {
    logger.error('markMissedSessions cron error: ' + e.message);
  }
}, { scheduled: false });

/**
 * Every 30 minutes: send proof reminders for sessions that ended
 * within the last 8 hours but haven't been proven yet.
 */
const proofReminders = cron.schedule('*/30 * * * *', async () => {
  try {
    const now = new Date();
    const eightHrsAgo = new Date(now.getTime() - 8 * 60 * 60 * 1000);

    const sessions = await prisma.workoutSession.findMany({
      where: {
        status: 'scheduled',
        scheduledAt: { gte: eightHrsAgo, lte: now },
        proofImageUrl: null,
      },
      select: { id: true, userId: true },
    });

    for (const s of sessions) {
      await notifSvc.notifyProofRequired(s.userId, s.id);
    }
    if (sessions.length) logger.info(`Sent ${sessions.length} proof reminders`);
  } catch (e) {
    logger.error('proofReminders cron error: ' + e.message);
  }
}, { scheduled: false });

const startJobs = () => {
  markMissedSessions.start();
  proofReminders.start();

  // 1. Mark missed sessions (every 15 min)
  // (Check if you already have this — if yes, update it to use xpCtrl)
  cron.schedule('*/15 * * * *', async () => {
    try {
      const r = await sessCtrl.markIncomplete();
      if (r?.marked > 0)
        logger.info(`[CRON] markIncomplete: ${r.marked} sessions marked missed`);
    } catch (e) { logger.error('[CRON] markIncomplete: ' + e.message); }
  });

  // 2. Trust score decay — daily 2 AM IST (8:30 PM UTC)
  cron.schedule('30 20 * * *', async () => {
    try {
      const r = await xpCtrl.runTrustDecay();
      logger.info(`[CRON] trustDecay: ${r.decayed}/${r.processed} users decayed`);
    } catch (e) { logger.error('[CRON] trustDecay: ' + e.message); }
  });

  // 3. Weekly XP reset — Saturday 11:59 PM IST (6:29 PM UTC)
  cron.schedule('29 18 * * 6', async () => {
    try {
      const r = await xpCtrl.resetWeeklyXP();
      logger.info(`[CRON] weeklyXpReset: ${r.reset} users reset`);
    } catch (e) { logger.error('[CRON] weeklyXpReset: ' + e.message); }
  });

  // 4. Monthly XP reset — last day of month 11:59 PM IST
  cron.schedule('29 18 * * *', async () => {
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
  cron.schedule('31 18 28-31 * *', async () => {
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
  cron.schedule('*/30 * * * *', async () => {
    try {
      const r = await strikeCtrl.expireStrikes();
      if (r?.deleted > 0)
        logger.info(`[CRON] expireStrikes: ${r.deleted} deleted`);
    } catch (e) { logger.error('[CRON] expireStrikes: ' + e.message); }
  });

  // 7. Strike streak warnings — daily 9 PM IST (3:30 PM UTC)
  cron.schedule('30 15 * * *', async () => {
    try {
      const r = await strikeCtrl.sendStreakWarnings();
      if (r?.warned > 0)
        logger.info(`[CRON] streakWarnings: ${r.warned} matches warned`);
    } catch (e) { logger.error('[CRON] streakWarnings: ' + e.message); }
  });

  // 8. Break expired Flash streaks — every hour
  cron.schedule('0 * * * *', async () => {
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
  cron.schedule('*/10 * * * *', async () => {
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
  cron.schedule('*/5 * * * *', async () => {
    try {
      const r = await sessCtrl.processProofConfirmations();
      if (r.reminded || r.closed)
        logger.info(`[CRON] proofConfirm: ${r.reminded} reminded, ${r.closed} auto-closed`);
    } catch (e) { logger.error('[CRON] proofConfirm: ' + e.message); }
  });

  // 11. "Session in 1 hour" reminder — every 5 min
  cron.schedule('*/5 * * * *', async () => {
    try {
      const r = await require('../services/engagement.service').sendSessionStartReminders();
      if (r.sent) logger.info(`[CRON] sessionStartReminders: ${r.sent} sent`);
    } catch (e) { logger.error('[CRON] sessionStartReminders: ' + e.message); }
  });

  // 12. Win-back nudges (inactive 3/7/14 days) — daily 7:00 PM IST (13:30 UTC)
  cron.schedule('30 13 * * *', async () => {
    try {
      await require('../services/engagement.service').sendWinbackNudges();
    } catch (e) { logger.error('[CRON] winback: ' + e.message); }
  });

  // 13. Clean old gym check-ins — daily 3:00 AM IST (21:30 UTC)
  cron.schedule('30 21 * * *', async () => {
    try {
      const r = await require('../controllers/gym.controller').cleanupCheckins();
      if (r.deleted) logger.info(`[CRON] gymCheckins cleanup: ${r.deleted}`);
    } catch (e) { logger.error('[CRON] gymCheckins cleanup: ' + e.message); }
  });

  logger.info('Background jobs started');
};

const stopJobs = () => {
  markMissedSessions.stop();
  proofReminders.stop();
};

module.exports = { startJobs, stopJobs };
