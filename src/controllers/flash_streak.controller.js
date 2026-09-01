'use strict';
// ─────────────────────────────────────────────────────────
//  flash_streak.controller.js
//  Sesh Flash Streak Logic — Pure social, no fitness tie
// ─────────────────────────────────────────────────────────
const { v4: uuid } = require('uuid');
const prisma        = require('../config/db');
const res_          = require('../utils/response');

// ── Helper: get or create streak pair ────────────────────
// Always store with smaller userId as userAId (canonical order)
const _getOrCreateStreak = async (userIdA, userIdB) => {
  const [minId, maxId] = [userIdA, userIdB].sort();
  let streak = await prisma.flashStreak.findUnique({
    where: { userAId_userBId: { userAId: minId, userBId: maxId } },
  });
  if (!streak) {
    streak = await prisma.flashStreak.create({
      data: {
        id:      uuid(),
        userAId: minId,
        userBId: maxId,
      },
    });
  }
  return streak;
};

// ── Helper: is within same 24hr window ───────────────────
const _inWindow = (windowStart) => {
  if (!windowStart) return false;
  const now      = Date.now();
  const start    = new Date(windowStart).getTime();
  const WINDOW   = 24 * 60 * 60 * 1000; // 24 hours
  return (now - start) < WINDOW;
};

// ── POST /flash/send — called after Flash is sent ────────
// strike.controller already handles the actual message
// This ONLY handles streak logic
const recordFlashSent = async (req, res, next) => {
  try {
    const senderId   = req.user.id;
    const { buddyId } = req.body;

    if (!buddyId) return res_.error(res, 'buddyId required', 400);
    if (buddyId === senderId) return res_.error(res, 'Cannot send to yourself', 400);

    const streak  = await _getOrCreateStreak(senderId, buddyId);
    const now     = new Date();
    const isUserA = streak.userAId === senderId;

    // Check if current window is still active
    const windowActive = _inWindow(streak.lastWindowStart);

    // ── Case 1: Window expired or no window — start fresh ──
    if (!windowActive) {
      // Reset window, record this user's send
      const updateData = {
        lastWindowStart: now,
        userASentAt:     isUserA ? now : null,
        userBSentAt:     isUserA ? null : now,
      };
      await prisma.flashStreak.update({
        where: { id: streak.id },
        data:  updateData,
      });
      return res_.success(res, {
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        waitingForBuddy: true,
        message: 'Flash recorded. Waiting for buddy to send back.',
      });
    }

    // ── Case 2: Window active ────────────────────────────
    const alreadySent  = isUserA ? streak.userASentAt : streak.userBSentAt;
    const buddySent    = isUserA ? streak.userBSentAt : streak.userASentAt;

    // Sender already sent in this window — no double count
    if (alreadySent) {
      return res_.success(res, {
        currentStreak:  streak.currentStreak,
        longestStreak:  streak.longestStreak,
        waitingForBuddy: !buddySent,
        message: 'Already sent in this window.',
      });
    }

    // Mark this user as sent
    const sentUpdate = isUserA
        ? { userASentAt: now }
        : { userBSentAt: now };

    // ── Both sent → increment streak ──────────────────────
    if (buddySent) {
      const newStreak    = streak.currentStreak + 1;
      const newLongest   = Math.max(newStreak, streak.longestStreak);
      await prisma.flashStreak.update({
        where: { id: streak.id },
        data: {
          ...sentUpdate,
          currentStreak:   newStreak,
          longestStreak:   newLongest,
          lastStreakAt:    now,
          // Reset window for next cycle
          lastWindowStart: now,
          userASentAt:     null,
          userBSentAt:     null,
        },
      });
      return res_.success(res, {
        currentStreak:  newStreak,
        longestStreak:  newLongest,
        waitingForBuddy: false,
        streakIncreased: true,
        message: `🔥 Streak is now ${newStreak}!`,
      });
    }

    // Buddy hasn't sent yet — just record this send
    await prisma.flashStreak.update({
      where: { id: streak.id },
      data:  sentUpdate,
    });

    return res_.success(res, {
      currentStreak:  streak.currentStreak,
      longestStreak:  streak.longestStreak,
      waitingForBuddy: true,
      message: 'Flash recorded. Waiting for buddy to send back.',
    });

  } catch (e) { next(e); }
};

// ── GET /flash/streaks — get all streaks for current user ─
const getMyStreaks = async (req, res, next) => {
  try {
    const myId = req.user.id;
    const streaks = await prisma.flashStreak.findMany({
      where: {
        OR: [{ userAId: myId }, { userBId: myId }],
      },
      include: {
        userA: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        userB: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
      orderBy: { currentStreak: 'desc' },
    });

    const result = streaks.map(s => {
      const isUserA   = s.userAId === myId;
      const buddy     = isUserA ? s.userB : s.userA;
      const iSent     = isUserA ? !!s.userASentAt : !!s.userBSentAt;
      const buddySent = isUserA ? !!s.userBSentAt : !!s.userASentAt;
      const windowActive = _inWindow(s.lastWindowStart);

      // Flash status for this pair today
      let flashStatus = 'send_now';    // neither sent
      if (iSent && !buddySent)  flashStatus = 'waiting';   // I sent, buddy hasn't
      if (!iSent && buddySent)  flashStatus = 'respond';   // buddy sent, I haven't
      if (iSent && buddySent)   flashStatus = 'done';      // both sent today

      if (!windowActive) flashStatus = 'send_now'; // window expired

      return {
        buddyId:       buddy.id,
        buddyName:     `${buddy.firstName} ${buddy.lastName}`,
        buddyAvatar:   buddy.avatarUrl,
        currentStreak: s.currentStreak,
        longestStreak: s.longestStreak,
        flashStatus,   // 'send_now' | 'waiting' | 'respond' | 'done'
        lastStreakAt:  s.lastStreakAt,
      };
    });

    return res_.success(res, { streaks: result });
  } catch (e) { next(e); }
};

// ── GET /flash/streak/:buddyId — single pair streak ───────
const getPairStreak = async (req, res, next) => {
  try {
    const myId    = req.user.id;
    const buddyId = req.params.buddyId;
    const streak  = await _getOrCreateStreak(myId, buddyId);
    const isUserA = streak.userAId === myId;
    const iSent   = isUserA ? !!streak.userASentAt : !!streak.userBSentAt;
    const buddySent = isUserA ? !!streak.userBSentAt : !!streak.userASentAt;
    const windowActive = _inWindow(streak.lastWindowStart);

    let flashStatus = 'send_now';
    if (windowActive) {
      if (iSent && !buddySent)  flashStatus = 'waiting';
      if (!iSent && buddySent)  flashStatus = 'respond';
      if (iSent && buddySent)   flashStatus = 'done';
    }

    return res_.success(res, {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      flashStatus,
    });
  } catch (e) { next(e); }
};

// ── CRON: Break expired streaks — run every hour ──────────
const breakExpiredStreaks = async () => {
  const WINDOW   = 24 * 60 * 60 * 1000;
  const cutoff   = new Date(Date.now() - WINDOW);

  // Find streaks where window started but both didn't complete
  const expired = await prisma.flashStreak.findMany({
    where: {
      lastWindowStart: { lt: cutoff },
      currentStreak:   { gt: 0 },
      OR: [
        { userASentAt: null },  // userA didn't send
        { userBSentAt: null },  // userB didn't send
      ],
    },
  });

  for (const s of expired) {
    await prisma.flashStreak.update({
      where: { id: s.id },
      data: {
        currentStreak:   0,
        userASentAt:     null,
        userBSentAt:     null,
        lastWindowStart: null,
      },
    });
  }

  return { broken: expired.length };
};

module.exports = {
  recordFlashSent,
  getMyStreaks,
  getPairStreak,
  breakExpiredStreaks,
};
