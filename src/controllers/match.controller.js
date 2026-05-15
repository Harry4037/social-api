'use strict';
const { v4: uuid } = require('uuid');
const prisma     = require('../config/db');
const res_       = require('../utils/response');
const { formatBuddyProfile } = require('../utils/formatUser');
const { computeCompatibility, haversine } = require('../utils/compatibility');
const notifSvc   = require('../services/notification.service');
const xpSvc      = require('../services/xp.service');

const DAILY_LIMIT_FREE = 5;
const DAILY_LIMIT_PRO  = 999;

// GET /match/discover
const discover = async (req, res, next) => {
  try {
    const { activity, level, lat, lng, maxDistance = 50, page = 1, limit = 20 } = req.query;
    const me = await prisma.user.findUnique({ where: { id: req.user.id } });

    // Users already swiped on
    const alreadySwiped = await prisma.swipe.findMany({
      where:  { swiperId: req.user.id },
      select: { swipedId: true },
    });
    const excludeIds = alreadySwiped.map(s => s.swipedId).concat([req.user.id]);

    const where = {
      id:      { notIn: excludeIds },
      status:  'ACTIVE',
      isBanned: false,
    };
    if (activity) where.primaryActivity = activity;
    if (level)    where.experienceLevel  = level;

    const users = await prisma.user.findMany({
      where,
      take:    Number(limit),
      skip:    (Number(page) - 1) * Number(limit),
      include: { _count: { select: { matchesA: true, sessionsAsUser: true } } },
    });

    // Compute compat + distance, apply geo filter
    const results = users
      .map(u => {
        const compatibilityScore = computeCompatibility(me, u);
        const distanceKm = me.latitude && me.longitude && u.latitude && u.longitude
          ? haversine(Number(me.latitude), Number(me.longitude), Number(u.latitude), Number(u.longitude))
          : null;
        const isOnline = u.lastActiveAt
          ? (Date.now() - new Date(u.lastActiveAt).getTime()) < 2 * 60 * 1000
          : false;
        return { ...u, compatibilityScore, distanceKm, isOnline };
      })
      .filter(u => u.distanceKm === null || u.distanceKm <= Number(maxDistance))
      .sort((a, b) => b.compatibilityScore - a.compatibilityScore)
      .map(u => formatBuddyProfile(u, {
        compatibilityScore: u.compatibilityScore,
        distanceKm:         u.distanceKm,
        isOnline:           u.isOnline,
      }));

    return res_.success(res, results);
  } catch (e) { next(e); }
};

// POST /match/like
const like = async (req, res, next) => {
  try {
    const { targetUserId } = req.body;
    const myId = req.user.id;

    if (targetUserId === myId) return res_.error(res, 'Cannot like yourself', 400);

    // Daily swipe quota
    const today = new Date().toISOString().slice(0, 10);
    const daily = await prisma.dailySwipe.upsert({
      where:  { userId_date: { userId: myId, date: today } },
      update: { count: { increment: 1 } },
      create: { userId: myId, date: today, count: 1 },
    });
    const limit = req.user.subscriptionPlan === 'free' ? DAILY_LIMIT_FREE : DAILY_LIMIT_PRO;
    if (daily.count > limit) {
      return res_.error(res, `Daily swipe limit (${limit}) reached — upgrade to Pro for unlimited swipes`, 429);
    }

    // Upsert the swipe
    await prisma.swipe.upsert({
      where:  { swiperId_swipedId: { swiperId: myId, swipedId: targetUserId } },
      update: { action: 'like' },
      create: { id: uuid(), swiperId: myId, swipedId: targetUserId, action: 'like' },
    });

    // Check mutual like → create match
    const mutual = await prisma.swipe.findFirst({
      where: { swiperId: targetUserId, swipedId: myId, action: 'like' },
    });

    if (mutual) {
      // Ensure canonical order (smaller id first to avoid duplicate match)
      const [userAId, userBId] = [myId, targetUserId].sort();
      const existing = await prisma.match.findUnique({
        where: { userAId_userBId: { userAId, userBId } },
      });

      if (!existing) {
        const matchId = uuid();
        const chatId  = uuid();
        await prisma.$transaction([
          prisma.match.create({ data: { id: matchId, userAId, userBId } }),
          prisma.chat.create({
            data: {
              id: chatId, matchId, userAId, userBId,
            },
          }),
        ]);

        await notifSvc.notifyMatch(myId, targetUserId, matchId);
        await Promise.all([
          xpSvc.awardXp(myId,         'buddy_matched'),
          xpSvc.awardXp(targetUserId, 'buddy_matched'),
        ]);

        return res_.success(res, { matched: true, matchId });
      }
    }

    return res_.success(res, { matched: false });
  } catch (e) { next(e); }
};

// POST /match/skip
const skip = async (req, res, next) => {
  try {
    const { targetUserId } = req.body;
    await prisma.swipe.upsert({
      where:  { swiperId_swipedId: { swiperId: req.user.id, swipedId: targetUserId } },
      update: { action: 'skip' },
      create: { id: uuid(), swiperId: req.user.id, swipedId: targetUserId, action: 'skip' },
    });
    return res_.success(res, null, 'Skipped');
  } catch (e) { next(e); }
};

// GET /match/buddies
const getBuddies = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const myId = req.user.id;
    const skip = (Number(page) - 1) * Number(limit);

    const [matches, total] = await Promise.all([
      prisma.match.findMany({
        where:   { OR: [{ userAId: myId }, { userBId: myId }] },
        include: {
          userA: { include: { _count: { select: { matchesA: true, sessionsAsUser: true } } } },
          userB: { include: { _count: { select: { matchesA: true, sessionsAsUser: true } } } },
        },
        skip, take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.match.count({ where: { OR: [{ userAId: myId }, { userBId: myId }] } }),
    ]);

    const me = await prisma.user.findUnique({ where: { id: myId } });
    const buddies = matches.map(m => {
      const buddy = m.userAId === myId ? m.userB : m.userA;
      return formatBuddyProfile(buddy, {
        compatibilityScore: computeCompatibility(me, buddy),
      });
    });

    return res_.paginated(res, buddies, { page, limit, total });
  } catch (e) { next(e); }
};

// DELETE /match/buddies/:buddyId
const removeBuddy = async (req, res, next) => {
  try {
    const myId    = req.user.id;
    const buddyId = req.params.buddyId;
    const [a, b]  = [myId, buddyId].sort();

    await prisma.match.deleteMany({
      where: { userAId: a, userBId: b },
    });
    return res_.success(res, null, 'Buddy removed');
  } catch (e) { next(e); }
};

module.exports = { discover, like, skip, getBuddies, removeBuddy };
