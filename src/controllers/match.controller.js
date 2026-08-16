'use strict';
const { v4: uuid } = require('uuid');
const prisma = require('../config/db');
const res_ = require('../utils/response');
const { formatBuddyProfile } = require('../utils/formatUser');
const { computeCompatibility, haversine } = require('../utils/compatibility');
const notifSvc = require('../services/notification.service');
const xpSvc = require('../services/xp.service');

const DAILY_LIMIT_FREE = 5;
const DAILY_LIMIT_PRO = 999;

// GET /match/discover
const discover = async (req, res, next) => {
  try {
    const { activity, level, lat, lng, maxDistance = 50, page = 1, limit = 20 } = req.query;
    const me = await prisma.user.findUnique({ where: { id: req.user.id } });

    // Users already swiped on
    const alreadySwiped = await prisma.swipe.findMany({
      where: { swiperId: req.user.id },
      select: { swipedId: true },
    });
    const excludeIds = alreadySwiped.map(s => s.swipedId).concat([req.user.id]);

    const where = {
      id: { notIn: excludeIds },
      status: 'ACTIVE',
      isBanned: false,
    };
    if (activity) where.primaryActivity = activity;
    if (level) where.experienceLevel = level;

    const users = await prisma.user.findMany({
      where,
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit),
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
        distanceKm: u.distanceKm,
        isOnline: u.isOnline,
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
      where: { userId_date: { userId: myId, date: today } },
      update: { count: { increment: 1 } },
      create: { userId: myId, date: today, count: 1 },
    });
    const limit = req.user.subscriptionPlan === 'free' ? DAILY_LIMIT_FREE : DAILY_LIMIT_PRO;
    if (daily.count > limit) {
      return res_.error(res, `Daily swipe limit (${limit}) reached — upgrade to Pro for unlimited swipes`, 429);
    }

    // Upsert the swipe
    await prisma.swipe.upsert({
      where: { swiperId_swipedId: { swiperId: myId, swipedId: targetUserId } },
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
        const chatId = uuid();
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
          xpSvc.awardXp(myId, 'buddy_matched'),
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
      where: { swiperId_swipedId: { swiperId: req.user.id, swipedId: targetUserId } },
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
        where: { OR: [{ userAId: myId }, { userBId: myId }] },
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
    const myId = req.user.id;
    const buddyId = req.params.buddyId;
    const [a, b] = [myId, buddyId].sort();

    await prisma.match.deleteMany({
      where: { userAId: a, userBId: b },
    });
    return res_.success(res, null, 'Buddy removed');
  } catch (e) { next(e); }
};

const swipe = async (req, res, next) => {
  try {
    const { targetId, action = 'like' } = req.body;
    const userId = req.user.id;

    if (!targetId) return res_.error(res, 'targetId required', 422);
    if (userId === targetId) return res_.error(res, 'Cannot swipe yourself', 400);

    // Get target user
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, isInfluencer: true, subscriptionPlan: true },
    });
    if (!target) return res_.error(res, 'User not found', 404);

    // ── ELITE CHECK — Influencer match requires Elite plan ─
    if (target.isInfluencer && action === 'like') {
      if (req.user.subscriptionPlan !== 'elite') {
        return res_.error(res,
          'Upgrade to Elite plan to connect with Influencers',
          403,
          { code: 'ELITE_REQUIRED', targetId }
        );
      }

      // Check monthly session limit
      const limitCheck = await checkInfluencerSessionLimit(userId, targetId);
      if (!limitCheck.allowed) {
        return res_.error(res,
          `You've used all ${limitCheck.limit} sessions with this influencer this month. Available next month.`,
          429,
          { code: 'SESSION_LIMIT_REACHED', ...limitCheck }
        );
      }
    }

    // Daily swipe limit check (Free users)
    if (req.user.subscriptionPlan === 'free') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dailySwipe = await prisma.dailySwipe.findFirst({
        where: { userId, date: { gte: today } },
      });
      if (dailySwipe && dailySwipe.count >= 10)
        return res_.error(res, 'Daily swipe limit reached. Upgrade to Pro for unlimited swipes.', 429,
          { code: 'DAILY_LIMIT_REACHED' });
    }

    // Record swipe
    await prisma.swipe.upsert({
      where: { swiperId_swipedId: { swiperId: userId, swipedId: targetId } },
      update: { action },
      create: { id: uuid(), swiperId: userId, swipedId: targetId, action },
    });

    // Update daily swipe count
    const today = new Date(); today.setHours(0, 0, 0, 0);
    await prisma.dailySwipe.upsert({
      where: { userId_date: { userId, date: today } },
      update: { count: { increment: 1 } },
      create: { id: uuid(), userId, date: today, count: 1 },
    });

    // Deduct 1 chat token for like (to start chat)
    if (action === 'like') {
      await prisma.user.update({
        where: { id: userId },
        data: { chatTokens: { decrement: 1 } },
      });
    }

    // Check mutual like → create match
    if (action === 'like' || action === 'super_like') {
      const mutual = await prisma.swipe.findFirst({
        where: { swiperId: targetId, swipedId: userId, action: { in: ['like', 'super_like'] } },
      });

      if (mutual) {
        // Check match doesn't already exist
        const existingMatch = await prisma.match.findFirst({
          where: {
            OR: [
              { userAId: userId, userBId: targetId },
              { userAId: targetId, userBId: userId },
            ],
          },
        });

        if (!existingMatch) {
          const match = await prisma.match.create({
            data: {
              id: uuid(),
              userAId: userId,
              userBId: targetId,
              status: 'active',
            },
          });

          // Create chat
          await prisma.chat.create({
            data: {
              id: uuid(),
              matchId: match.id,
              userAId: userId,
              userBId: targetId,
            },
          });

          // Notify both
          await _notify(userId, `🤝 You matched with ${target.id}!`, 'new_match', { matchId: match.id });
          await _notify(targetId, `🤝 You have a new match!`, 'new_match', { matchId: match.id });

          return res_.success(res, { matched: true, matchId: match.id }, 'It\'s a match! 🎉');
        }
      }

      // Not mutual yet — notify target of like (match request)
      await _notify(targetId,
        `Someone wants to train with you! Check your match requests.`,
        'match_request',
        { fromUserId: userId }
      );
    }

    return res_.success(res, { matched: false }, 'Swipe recorded');
  } catch (e) { next(e); }
};

// ── GET MATCH REQUESTS (Requests tab in chats) ────────────
// GET /api/match/requests
const getMatchRequests = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Swipes where others liked me but no match yet
    const likes = await prisma.swipe.findMany({
      where: {
        swipedId: userId,
        action: { in: ['like', 'super_like'] },
      },
      include: {
        swiper: {
          select: {
            id: true, firstName: true, lastName: true,
            avatarUrl: true, city: true, primaryActivity: true,
            level: true, trustScore: true, isInfluencer: true,
            instagramHandle: true, instagramFollowers: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter out already matched
    const existingMatches = await prisma.match.findMany({
      where: {
        OR: [
          { userAId: userId },
          { userBId: userId },
        ],
        status: 'active',
      },
      select: { userAId: true, userBId: true },
    });

    const matchedUserIds = new Set(
      existingMatches.flatMap(m => [m.userAId, m.userBId])
        .filter(id => id !== userId)
    );

    // Filter: only pending (not yet matched, not rejected by me)
    const mySwipes = await prisma.swipe.findMany({
      where: { swiperId: userId },
      select: { swipedId: true },
    });
    const iSwiped = new Set(mySwipes.map(s => s.swipedId));

    const pendingRequests = likes.filter(l =>
      !matchedUserIds.has(l.swiperId) &&
      !iSwiped.has(l.swiperId)         // I haven't swiped them back yet
    );

    return res_.success(res, {
      requests: pendingRequests.map(l => ({
        swipeId: l.id,
        user: l.swiper,
        isSuperLike: l.action === 'super_like',
        createdAt: l.createdAt,
      })),
      count: pendingRequests.length,
    });
  } catch (e) { next(e); }
};

// ── ACCEPT MATCH REQUEST ──────────────────────────────────
// POST /api/match/requests/:swipeId/accept
const acceptRequest = async (req, res, next) => {
  try {
    const { swipeId } = req.params;
    const userId = req.user.id;

    const swipe = await prisma.swipe.findUnique({ where: { id: swipeId } });
    if (!swipe) return res_.error(res, 'Request not found', 404);
    if (swipe.swipedId !== userId)
      return res_.error(res, 'Not your request', 403);

    const fromUserId = swipe.swiperId;

    // Create match
    const match = await prisma.match.create({
      data: {
        id: uuid(),
        userAId: fromUserId,
        userBId: userId,
        status: 'active',
      },
    });

    // Create chat
    await prisma.chat.create({
      data: {
        id: uuid(),
        matchId: match.id,
        userAId: fromUserId,
        userBId: userId,
      },
    });

    // Record my swipe too
    await prisma.swipe.upsert({
      where: { swiperId_swipedId: { swiperId: userId, swipedId: fromUserId } },
      update: { action: 'like' },
      create: { id: uuid(), swiperId: userId, swipedId: fromUserId, action: 'like' },
    });

    // Notify the person who liked me
    await _notify(fromUserId,
      '🤝 Your match request was accepted!',
      'match_accepted',
      { matchId: match.id }
    );

    return res_.success(res, {
      matched: true,
      matchId: match.id,
    }, 'Match accepted! 🎉');
  } catch (e) { next(e); }
};

// ── DECLINE MATCH REQUEST ─────────────────────────────────
// POST /api/match/requests/:swipeId/decline
const declineRequest = async (req, res, next) => {
  try {
    const { swipeId } = req.params;
    const userId = req.user.id;

    const swipe = await prisma.swipe.findUnique({ where: { id: swipeId } });
    if (!swipe) return res_.error(res, 'Request not found', 404);
    if (swipe.swipedId !== userId)
      return res_.error(res, 'Not your request', 403);

    // Record my decline swipe
    await prisma.swipe.upsert({
      where: { swiperId_swipedId: { swiperId: userId, swipedId: swipe.swiperId } },
      update: { action: 'skip' },
      create: { id: uuid(), swiperId: userId, swipedId: swipe.swiperId, action: 'skip' },
    });

    return res_.success(res, {}, 'Request declined');
  } catch (e) { next(e); }
};

// ── Helper ────────────────────────────────────────────────
const _notify = async (userId, message, type, data = {}) => {
  try {
    await prisma.notification.create({
      data: {
        id: uuid(), userId, type,
        title: message, body: message,
        data: JSON.stringify(data), isRead: false,
      },
    });
  } catch (_) { }
};

module.exports = {
  discover, like,
  skip, getBuddies,
  removeBuddy, swipe,
  getMatchRequests,
  acceptRequest, declineRequest
};
