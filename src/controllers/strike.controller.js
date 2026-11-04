// ─────────────────────────────────────────────────────────
//  strike.controller.js
//  Strike 2 — Buddy Strike (Snap style)
//  One-time view, streak tracking, emoji reactions
// ─────────────────────────────────────────────────────────
const { v4: uuid }     = require('uuid');
const prisma           = require('../config/db');
const res_             = require('../utils/response');
const { awardXP, updateTrust } = require('./xp.controller');

const VALID_EMOJIS = ['💪', '🔥', '😤', '🏆', '🤝', '😮'];

// ── SEND STRIKE 2 ─────────────────────────────────────────
// POST /api/strikes
const sendStrike = async (req, res, next) => {
  try {
    const { matchId, imageUrl, caption } = req.body;
    const senderId = req.user.id;

    if (!matchId || !imageUrl)
      return res_.error(res, 'matchId and imageUrl required', 422);

    // Validate match exists and user is part of it
    const match = await prisma.match.findFirst({
      where: {
        id: matchId,
        OR: [{ userAId: senderId }, { userBId: senderId }],
        status: 'active',
      },
    });
    if (!match) return res_.error(res, 'Match not found', 404);

    const receiverId = match.userAId === senderId ? match.userBId : match.userAId;

    // Check: only 1 unviewed strike per match at a time
    const existing = await prisma.buddyStrike.findFirst({
      where: {
        matchId,
        senderId,
        viewedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (existing)
      return res_.error(res, 'You already have an unviewed strike pending', 409);

    // Create strike — expires in 24hrs if not viewed
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const strike = await prisma.buddyStrike.create({
      data: {
        id: uuid(),
        senderId,
        receiverId,
        matchId,
        imageUrl,
        caption: caption || null,
        expiresAt,
      },
    });

    // Update match strike count + lastStrikeAt
    await prisma.match.update({
      where: { id: matchId },
      data:  {
        strikeCount:  { increment: 1 },
        lastStrikeAt: new Date(),
      },
    });

    // Check streak — did both users send within 24hrs?
    await _checkAndUpdateStreak(match, senderId, receiverId);

    // Notify receiver
    await _notify(receiverId,
      `⚡ ${req.user.firstName} sent you a Strike!`,
      'strike_received',
      { strikeId: strike.id, senderId }
    );

    return res_.created(res, {
      strikeId:   strike.id,
      expiresAt:  strike.expiresAt,
      receiverId,
    }, 'Strike sent');
  } catch (e) { next(e); }
};

// ── VIEW STRIKE 2 ─────────────────────────────────────────
// POST /api/strikes/:id/view
const viewStrike = async (req, res, next) => {
  try {
    const strike = await prisma.buddyStrike.findUnique({
      where: { id: req.params.id },
    });

    if (!strike)
      return res_.error(res, 'Strike not found or already expired', 404);
    if (strike.receiverId !== req.user.id)
      return res_.error(res, 'Not your strike', 403);
    if (strike.viewedAt)
      return res_.error(res, 'Already viewed', 409);
    if (new Date() > strike.expiresAt)
      return res_.error(res, 'Strike expired', 410);

    // Mark viewed — expires in 5 mins after view
    const viewedAt  = new Date();
    const expiresAt = new Date(viewedAt.getTime() + 5 * 60 * 1000);

    const updated = await prisma.buddyStrike.update({
      where: { id: strike.id },
      data:  { viewedAt, expiresAt },
    });

    return res_.success(res, {
      strikeId:  strike.id,
      imageUrl:  strike.imageUrl,
      caption:   strike.caption,
      senderId:  strike.senderId,
      viewedAt:  updated.viewedAt,
      expiresAt: updated.expiresAt,
    }, 'Strike viewed');
  } catch (e) { next(e); }
};

// ── REACT TO STRIKE 2 ─────────────────────────────────────
// POST /api/strikes/:id/react
const reactToStrike = async (req, res, next) => {
  try {
    const { emoji } = req.body;

    if (!VALID_EMOJIS.includes(emoji))
      return res_.error(res, `Invalid emoji. Use: ${VALID_EMOJIS.join(' ')}`, 422);

    const strike = await prisma.buddyStrike.findUnique({
      where: { id: req.params.id },
    });
    if (!strike)
      return res_.error(res, 'Strike not found', 404);
    if (strike.receiverId !== req.user.id)
      return res_.error(res, 'Not your strike', 403);
    if (!strike.viewedAt)
      return res_.error(res, 'View the strike first', 400);
    if (strike.reactEmoji)
      return res_.error(res, 'Already reacted', 409);

    await prisma.buddyStrike.update({
      where: { id: strike.id },
      data:  { reactEmoji: emoji },
    });

    // Notify sender of reaction
    await _notify(strike.senderId,
      `${emoji} ${req.user.firstName} reacted to your Strike!`,
      'strike_reacted',
      { strikeId: strike.id, emoji, reactorId: req.user.id }
    );

    return res_.success(res, { emoji }, 'Reaction sent');
  } catch (e) { next(e); }
};

// ── GET MY PENDING STRIKES ────────────────────────────────
// GET /api/strikes/pending
const getPendingStrikes = async (req, res, next) => {
  try {
    const strikes = await prisma.buddyStrike.findMany({
      where: {
        receiverId: req.user.id,
        viewedAt:   null,
        expiresAt:  { gt: new Date() },
      },
      include: {
        sender: { select: { id: true, firstName: true, avatarUrl: true } },
        match:  { select: { id: true, buddyStrikeStreak: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res_.success(res, {
      strikes: strikes.map(s => ({
        id:           s.id,
        sender:       s.sender,
        matchId:      s.matchId,
        streak:       s.match?.buddyStrikeStreak || 0,
        expiresAt:    s.expiresAt,
        // Don't expose imageUrl until viewed
      })),
    });
  } catch (e) { next(e); }
};

// ── GET STREAK FOR MATCH ──────────────────────────────────
// GET /api/strikes/streak/:matchId
const getStreak = async (req, res, next) => {
  try {
    const match = await prisma.match.findFirst({
      where: {
        id: req.params.matchId,
        OR: [{ userAId: req.user.id }, { userBId: req.user.id }],
      },
      select: {
        buddyStrikeStreak: true,
        strikeCount:       true,
        lastStrikeAt:      true,
      },
    });
    if (!match) return res_.error(res, 'Match not found', 404);

    return res_.success(res, {
      streak:      match.buddyStrikeStreak,
      totalStrikes: match.strikeCount,
      lastStrikeAt: match.lastStrikeAt,
    });
  } catch (e) { next(e); }
};

// ── EXPIRE OLD STRIKES (called by CRON every 30min) ──────
const expireStrikes = async () => {
  const result = await prisma.buddyStrike.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return { deleted: result.count };
};

// ── STREAK WARNING (called by CRON daily 9 PM IST) ───────
const sendStreakWarnings = async () => {
  // Streaks that have NOT gone up today (IST day) — they break tonight
  const { dayBounds } = require('./session.controller');
  const startOfDay = dayBounds(new Date()).start;

  const matchesAtRisk = await prisma.match.findMany({
    where: {
      buddyStrikeStreak: { gt: 0 },
      status: 'active',
      OR: [
        { streakCountedAt: null },
        { streakCountedAt: { lt: startOfDay } },
      ],
    },
    select: {
      id:     true,
      userAId: true,
      userBId: true,
      buddyStrikeStreak: true,
      userA: { select: { firstName: true } },
      userB: { select: { firstName: true } },
    },
  });

  let warned = 0;
  for (const match of matchesAtRisk) {
    // Warn both users
    await _notify(match.userAId,
      `🔥 ${match.buddyStrikeStreak}-day streak with ${match.userB.firstName} ends at midnight — send a Strike!`,
      'streak_warning',
      { matchId: match.id, streak: match.buddyStrikeStreak }
    );
    await _notify(match.userBId,
      `🔥 ${match.buddyStrikeStreak}-day streak with ${match.userA.firstName} ends at midnight — send a Strike!`,
      'streak_warning',
      { matchId: match.id, streak: match.buddyStrikeStreak }
    );
    warned++;
  }

  return { warned };
};

// ── INTERNAL: Check & update streak ───────────────────────
const _checkAndUpdateStreak = async (match, senderId, receiverId) => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Did the other person also send a strike in last 24hrs?
  const otherStrike = await prisma.buddyStrike.findFirst({
    where: {
      matchId:   match.id,
      senderId:  receiverId, // other person sent
      createdAt: { gte: yesterday },
    },
  });

  if (otherStrike) {
    // Both sent → streak continues, but at most +1 per day (two accounts
    // could hit the 7/30-day XP milestones in minutes before)
    const { dayBounds } = require('./session.controller');
    const today = dayBounds(now).start;
    const claim = await prisma.match.updateMany({
      where: { id: match.id, OR: [{ streakCountedAt: null }, { streakCountedAt: { lt: today } }] },
      data:  { buddyStrikeStreak: { increment: 1 }, streakCountedAt: now },
    });
    if (claim.count === 0) return { streak: match.buddyStrikeStreak, increased: false };
    const newStreak = match.buddyStrikeStreak + 1;

    // Milestone XP + Trust rewards
    if (newStreak === 7) {
      await awardXP(senderId,  25, 'strike_streak_7d', { matchId: match.id });
      await awardXP(receiverId, 25, 'strike_streak_7d', { matchId: match.id });
      await updateTrust(senderId,  0.5, 'strike_streak_7d');
      await updateTrust(receiverId, 0.5, 'strike_streak_7d');
    } else if (newStreak === 30) {
      await awardXP(senderId,  100, 'strike_streak_30d', { matchId: match.id });
      await awardXP(receiverId, 100, 'strike_streak_30d', { matchId: match.id });
      await updateTrust(senderId,  2.0, 'strike_streak_30d');
      await updateTrust(receiverId, 2.0, 'strike_streak_30d');
    }
  }
  // else: streak stays as-is, sender's strike is pending other person's response
};

// ── INTERNAL: Create notification ────────────────────────
// Uses the notification service (valid type, push, quiet hours, daily cap)
const _notify = (userId, message, kind, data = {}) =>
  require('../services/notification.service').notifyKind(userId, kind, message, data).catch(() => null);

// ── CRON (00:05 IST): break streaks that missed a whole day ──
// Pro/Elite pairs get one automatic "streak freeze" every 30 days.
const breakStrikeStreaks = async () => {
  const { dayBounds } = require('./session.controller');
  const yesterdayStart = new Date(dayBounds(new Date()).start.getTime() - 24 * 3600e3);
  const now = new Date();
  const missed = await prisma.match.findMany({
    where: {
      buddyStrikeStreak: { gt: 0 },
      OR: [{ streakCountedAt: null }, { streakCountedAt: { lt: yesterdayStart } }],
    },
    select: {
      id: true, buddyStrikeStreak: true, streakFreezeUsedAt: true, userAId: true, userBId: true,
      userA: { select: { firstName: true, subscriptionPlan: true } },
      userB: { select: { firstName: true, subscriptionPlan: true } },
    },
    take: 5000,
  });
  let broken = 0, frozen = 0;
  for (const m of missed) {
    const pro = [m.userA, m.userB].some(u => u && u.subscriptionPlan !== 'free');
    const freezeFree = !m.streakFreezeUsedAt || now - new Date(m.streakFreezeUsedAt) > 30 * 24 * 3600e3;
    if (pro && freezeFree) {
      // keep the streak: pretend it counted yesterday
      await prisma.match.update({ where: { id: m.id }, data: {
        streakFreezeUsedAt: now, streakCountedAt: new Date(yesterdayStart.getTime() + 60e3) } });
      for (const uid of [m.userAId, m.userBId]) {
        await _notify(uid, `🧊 Streak freeze used — your ${m.buddyStrikeStreak}-day streak is safe`, 'streak_warning', { matchId: m.id });
      }
      frozen++;
      continue;
    }
    await prisma.match.update({ where: { id: m.id }, data: { buddyStrikeStreak: 0 } });
    for (const uid of [m.userAId, m.userBId]) {
      await _notify(uid, `💔 Your ${m.buddyStrikeStreak}-day streak ended. Send a Strike to start a new one!`, 'streak_warning', { matchId: m.id });
    }
    broken++;
  }
  return { broken, frozen };
};

module.exports = {
  breakStrikeStreaks,
  sendStrike,
  viewStrike,
  reactToStrike,
  getPendingStrikes,
  getStreak,
  expireStrikes,
  sendStreakWarnings,
};
