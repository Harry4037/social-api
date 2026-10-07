'use strict';
// ─────────────────────────────────────────────────────────
//  scheduler_addon.js
//  ADD these jobs to your existing scheduler.js
//  (schedulers/scheduler.js)
//
//  Your existing scheduler already has some jobs.
//  Just add these new ones alongside existing ones.
// ─────────────────────────────────────────────────────────

// ── ADD THESE REQUIRES at top of existing scheduler.js ───
const xpCtrl     = require('../controllers/xp.controller');
const strikeCtrl = require('../controllers/strike.controller');
const sessCtrl   = require('../controllers/session.controller');

// ── ADD THESE JOBS in your existing startJobs() function ─

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
    const now      = new Date();
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
    const now      = new Date();
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
    const flashCtrl = require('./controllers/flash_streak.controller');
    const r = await flashCtrl.breakExpiredStreaks();
    if (r?.broken > 0)
      logger.info(`[CRON] flashStreakBreak: ${r.broken} streaks reset`);
  } catch (e) { logger.error('[CRON] flashStreakBreak: ' + e.message); }
});

// 8b. Clean expired boosts — every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    const deleted = await prisma.profileBoost.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (deleted.count > 0)
      logger.info(`[CRON] expiredBoosts: ${deleted.count} removed`);
  } catch(e) { logger.error('[CRON] expiredBoosts: ' + e.message); }
});

// 9. Auto launch cities on scheduled date — daily 9 AM IST (3:30 AM UTC)
cron.schedule('30 3 * * *', async () => {
  try {
    const waitlistCtrl = require('./controllers/waitlist.controller');
    const r = await waitlistCtrl.autoLaunchCheck();
    if (r?.launched > 0)
      logger.info(`[CRON] autoLaunch: ${r.launched} cities launched`);
  } catch (e) { logger.error('[CRON] autoLaunch: ' + e.message); }
});

// 10. Auto delete chat messages after 24 hours — every hour
// Sirf regular text messages delete honge
// Session invites, strike cards, proof cards — safe rahenge
cron.schedule('0 * * * *', async () => {
  try {
    const deleted = await prisma.message.deleteMany({
      where: {
        createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        type: 'text', // sirf text messages
      },
    });
    if (deleted.count > 0)
      logger.info(`[CRON] autoDeleteMessages: ${deleted.count} messages deleted`);
  } catch (e) { logger.error('[CRON] autoDeleteMessages: ' + e.message); }
});
