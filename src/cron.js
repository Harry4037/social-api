// ─────────────────────────────────────────────────────────
//  cron.js — All scheduled jobs
//  Uses node-cron
// ─────────────────────────────────────────────────────────
const cron    = require('node-cron');
const session = require('./controllers/session.controller');
const xp      = require('./controllers/xp.controller');
const strike  = require('./controllers/strike.controller');

// ── 1. Mark missed sessions (every 15 min) ───────────────
cron.schedule('*/15 * * * *', async () => {
  try {
    const r = await session.markIncomplete();
    if (r?.marked > 0) console.log(`[CRON] markIncomplete: ${r.marked} sessions marked missed`);
  } catch (e) { console.error('[CRON] markIncomplete error:', e.message); }
});

// ── 2. Trust score decay (daily 2 AM IST = 8:30 PM UTC) ──
cron.schedule('30 20 * * *', async () => {
  try {
    const r = await xp.runTrustDecay();
    console.log(`[CRON] trustDecay: ${r.decayed}/${r.processed} users decayed`);
  } catch (e) { console.error('[CRON] trustDecay error:', e.message); }
});

// ── 3. Weekly XP reset (Saturday 11:59 PM IST = 6:29 PM UTC)
cron.schedule('29 18 * * 6', async () => {
  try {
    const r = await xp.resetWeeklyXP();
    console.log(`[CRON] weeklyXpReset: ${r.reset} users reset`);
  } catch (e) { console.error('[CRON] weeklyXpReset error:', e.message); }
});

// ── 4. Monthly XP reset (last day 11:59 PM IST = 6:29 PM UTC)
// Runs daily — checks if today is last day of month
cron.schedule('29 18 * * *', async () => {
  try {
    const now  = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getDate() === 1) {
      const r = await xp.resetMonthlyXP();
      console.log(`[CRON] monthlyXpReset: ${r.reset} users reset`);
    }
  } catch (e) { console.error('[CRON] monthlyXpReset error:', e.message); }
});

// ── 5. Pro token refill (1st of month 12:01 AM IST = 6:31 PM UTC prev day)
cron.schedule('31 18 28-31 * *', async () => {
  try {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (tomorrow.getDate() === 1) {
      const r = await xp.refillProTokens();
      console.log(`[CRON] proTokenRefill: ${r.refilled}/${r.processed} Pro users refilled`);
    }
  } catch (e) { console.error('[CRON] proTokenRefill error:', e.message); }
});

// ── 6. Expire old Strike 2s (every 30 min) ───────────────
cron.schedule('*/30 * * * *', async () => {
  try {
    const r = await strike.expireStrikes();
    if (r?.deleted > 0) console.log(`[CRON] expireStrikes: ${r.deleted} strikes deleted`);
  } catch (e) { console.error('[CRON] expireStrikes error:', e.message); }
});

// ── 7. Streak warnings (daily 9 PM IST = 3:30 PM UTC) ────
cron.schedule('30 15 * * *', async () => {
  try {
    const r = await strike.sendStreakWarnings();
    if (r?.warned > 0) console.log(`[CRON] streakWarnings: ${r.warned} matches warned`);
  } catch (e) { console.error('[CRON] streakWarnings error:', e.message); }
});

console.log('[CRON] All 7 jobs scheduled');
