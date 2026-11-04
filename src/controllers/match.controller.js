'use strict';
const { v4: uuid } = require('uuid');
const prisma = require('../config/db');
const { withUserCounts, withUserCount } = require('../utils/relationCounts');
const res_ = require('../utils/response');
const { formatBuddyProfile, PHOTOS_SELECT } = require('../utils/formatUser');
const { computeCompatibility, haversine } = require('../utils/compatibility');
const notifSvc = require('../services/notification.service');
const xpSvc = require('../services/xp.service');
const { notBlockedWhere, isBlockedBetween } = require('./safety.controller');
// One daily rule for likes AND super-likes (Free). Skips are unlimited.
const DAILY_LIMIT_FREE = 5;
const { appDate } = require('../utils/appDate');
const DAILY_LIMIT_PRO = 999;

// GET /match/discover
// Scaling notes:
//  • Location filter runs IN THE DATABASE (bounding box on the indexed
//    latitude/longitude columns), then exact haversine in JS. Previously
//    20 random users were fetched and filtered by distance afterwards,
//    which returned empty pages once users were spread across cities.
//  • Already-swiped users are excluded with a relation filter instead of
//    loading the user's whole swipe history into memory.
const MAX_RADIUS_KM = 10;
const MIN_RADIUS_KM = 2;
const MAX_QUERY_SHIFT_KM = 25;
const discover = async (req, res, next) => {
  try {
    const { activity, level, lat, lng, maxDistance = 50, page = 1, limit = 20 } = req.query;
    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!me) return res_.error(res, 'User not found', 404);

    const pageNum  = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));
    // Min 2 km: tiny radii + moving the probe point turned Discover into a
    // "is she within 50 m of here?" location oracle
    const radiusKm = Math.min(Math.max(Number(maxDistance) || MAX_RADIUS_KM, MIN_RADIUS_KM), MAX_RADIUS_KM);

    // Location: from the app (fresh GPS) or the saved profile location.
    // A query point far from where I really am is ignored (no remote probing).
    const savedLat = me.latitude != null ? Number(me.latitude) : null;
    const savedLng = me.longitude != null ? Number(me.longitude) : null;
    let myLat = lat != null && lat !== '' ? Number(lat) : savedLat;
    let myLng = lng != null && lng !== '' ? Number(lng) : savedLng;
    if (savedLat != null && Number.isFinite(myLat) && Number.isFinite(myLng) &&
        haversine(savedLat, savedLng, myLat, myLng) > MAX_QUERY_SHIFT_KM) {
      myLat = savedLat; myLng = savedLng;
    }
    const hasLocation = Number.isFinite(myLat) && Number.isFinite(myLng);

    const where = {
      id: { not: req.user.id },
      status: 'ACTIVE',
      isBanned: false,
      profileVisibility: 'public', // Privacy: buddies-only / hidden stay out of Discover
      // not swiped by me yet (DB-side, no big NOT IN list)
      swipesReceived: { none: { swiperId: req.user.id } },
      // not blocked in either direction
      ...notBlockedWhere(req.user.id),
    };
    if (activity) where.primaryActivity = activity;
    if (level) where.experienceLevel = level;

    if (hasLocation) {
      // ~111.32 km per degree latitude; longitude shrinks with cos(lat)
      const box = radiusKm + 6; // snapped positions can move ~5 km
      const dLat = box / 111.32;
      const dLng = box / (111.32 * Math.max(Math.cos((myLat * Math.PI) / 180), 0.01));
      where.AND = [{
        OR: [
          {
            latitude:  { gte: myLat - dLat, lte: myLat + dLat },
            longitude: { gte: myLng - dLng, lte: myLng + dLng },
          },
          // users who never shared location stay discoverable (old behaviour)
          { latitude: null },
        ],
      }];
    }

    const now = new Date();
    // Over-fetch 2x so the exact-circle filter below still fills a page
    const users = await prisma.user.findMany({
      where,
      orderBy: [{ lastActiveAt: 'desc' }], // recently active people first
      take: limitNum * 2,
      skip: (pageNum - 1) * limitNum * 2,
      include: { photos: PHOTOS_SELECT },
    });
    await withUserCounts(users); // counts for these ≤40 people only
    const boostedUserIds = new Set(
      users.filter(u => u.boostExpiresAt && u.boostExpiresAt > now).map(u => u.id)
    );
    // New members get 48 h of extra visibility (right after paid boosts)
    const NEW_USER_MS = 48 * 3600e3;
    const isNewUser = (u) => !!u.createdAt && now - new Date(u.createdAt) < NEW_USER_MS;
    const meForDistance = hasLocation ? { ...me, latitude: myLat, longitude: myLng } : me;

    // Compute compat + distance, apply geo filter
    const results = users
      .map(u => {
        const compatibilityScore = computeCompatibility(me, u);
        // Other people's position is snapped to a grid (~1 km, ~5 km if they
        // turned location sharing off) before ANY distance maths
        const grid = u.shareLocation === false ? 0.05 : 0.01;
        const snap = (v) => Math.round(Number(v) / grid) * grid;
        const distanceKm = meForDistance.latitude != null && meForDistance.longitude != null &&
            u.latitude != null && u.longitude != null
          ? haversine(Number(meForDistance.latitude), Number(meForDistance.longitude), snap(u.latitude), snap(u.longitude))
          : null;
        const isOnline = u.lastActiveAt
          ? (Date.now() - new Date(u.lastActiveAt).getTime()) < 2 * 60 * 1000
          : false;
        const isBoosted = boostedUserIds.has(u.id);
        return { ...u, compatibilityScore, distanceKm, isOnline, isBoosted, isNew: isNewUser(u) };
      })
      .filter(u => {
        // Hard cap — 10km max (maxDistance from query, never more than 10)
        return u.distanceKm === null || u.distanceKm <= radiusKm;
      })
      .sort((a, b) => {
        // 0th priority — boosted profiles always first
        if (a.isBoosted !== b.isBoosted) return b.isBoosted ? 1 : -1;
        // 0.5 — new members (first 48 h)
        if (a.isNew !== b.isNew) return b.isNew ? 1 : -1;

        // 1st priority — same primary activity as logged in user
        const myActivity = me.primaryActivity;
        const aIsSame = a.primaryActivity === myActivity ? 0 : 1;
        const bIsSame = b.primaryActivity === myActivity ? 0 : 1;
        if (aIsSame !== bIsSame) return aIsSame - bIsSame;

        // 2nd priority — compatibility score
        if (b.compatibilityScore !== a.compatibilityScore)
          return b.compatibilityScore - a.compatibilityScore;

        // 3rd priority — distance (closer first)
        const aDist = a.distanceKm ?? 999;
        const bDist = b.distanceKm ?? 999;
        return aDist - bDist;
      })
      .map(u => formatBuddyProfile(u, {
        compatibilityScore: u.compatibilityScore,
        distanceKm: u.distanceKm,
        isOnline: u.isOnline,
        isBoosted: u.isBoosted,
        isNew: u.isNew,
      }))
      .slice(0, limitNum);

    return res_.success(res, results);
  } catch (e) { next(e); }
};

// POST /match/like
// Influencers: Elite plan only + monthly session limit. Shared by every
// path that can create a match (like, swipe like/super-like).
const influencerGate = async (req, targetId, target = null) => {
  const t = target || await prisma.user.findUnique({ where: { id: targetId }, select: { isInfluencer: true } });
  if (!t?.isInfluencer) return null;
  if (req.user.subscriptionPlan !== 'elite') {
    return { status: 403, message: 'Upgrade to Elite plan to connect with Influencers',
      extra: { code: 'ELITE_REQUIRED', targetId } };
  }
  // (was never imported here → every Elite like on an influencer crashed with a 500)
  const { checkInfluencerSessionLimit } = require('./influencer.controller');
  const limitCheck = await checkInfluencerSessionLimit(req.user.id, targetId);
  if (!limitCheck.allowed) {
    return { status: 429,
      message: `You've used all ${limitCheck.limit} sessions with this influencer this month. Available next month.`,
      extra: { code: 'SESSION_LIMIT_REACHED', ...limitCheck } };
  }
  return null;
};

const like = async (req, res, next) => {
  try {
    const { targetUserId } = req.body;
    const myId = req.user.id;

    if (targetUserId === myId) return res_.error(res, 'Cannot like yourself', 400);
    if (await isBlockedBetween(myId, targetUserId)) return res_.error(res, 'User not found', 404);
    const gate = await influencerGate(req, targetUserId);
    if (gate) return res_.error(res, gate.message, gate.status, gate.extra);

    // Daily swipe quota
    const today = appDate();
    const daily = await prisma.dailySwipe.upsert({
      where: { userId_date: { userId: myId, date: today } },
      update: { count: { increment: 1 } },
      create: { userId: myId, date: today, count: 1 },
    });
    const limit = req.user.subscriptionPlan === 'free' ? DAILY_LIMIT_FREE : DAILY_LIMIT_PRO;
    if (daily.count > limit) {
      return res_.error(res, `Daily like limit (${limit}) reached — upgrade to Pro for unlimited likes`, 429,
        { code: 'DAILY_LIMIT_REACHED' });
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
        try {
          await prisma.$transaction([
            prisma.match.create({ data: { id: matchId, userAId, userBId } }),
            prisma.chat.create({
              data: {
                id: chatId, matchId, userAId, userBId,
              },
            }),
          ]);
        } catch (e) {
          // Both liked at the same moment → the other request created it.
          // Not an error: reply "matched" with the existing chat.
          if (e.code !== 'P2002') throw e;
          const m = await prisma.match.findUnique({
            where: { userAId_userBId: { userAId, userBId } }, include: { chat: { select: { id: true } } },
          });
          if (!m) throw e;
          return res_.success(res, { matched: true, matchId: m.id, chatId: m.chat?.id ?? null });
        }

        await notifSvc.notifyMatch(myId, targetUserId, matchId);
        await Promise.all([
          xpSvc.awardXp(myId, 'buddy_matched'),
          xpSvc.awardXp(targetUserId, 'buddy_matched'),
        ]);

        return res_.success(res, { matched: true, matchId, chatId });
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
    const { page, limit, skip } = require('../utils/paging').pageParams(req.query, { def: 20, max: 100 });
    const myId = req.user.id;

    const [matches, total] = await Promise.all([
      prisma.match.findMany({
        // active only — removed / blocked buddies were still listed
        where: { status: 'active', OR: [{ userAId: myId }, { userBId: myId }] },
        include: {
          userA: { include: { photos: PHOTOS_SELECT } },
          userB: { include: { photos: PHOTOS_SELECT } },
        },
        skip, take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.match.count({ where: { status: 'active', OR: [{ userAId: myId }, { userBId: myId }] } }),
    ]);

    const me = await prisma.user.findUnique({ where: { id: myId } });
    await withUserCounts(matches.map(m => (m.userAId === myId ? m.userB : m.userA)));
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
    // Matches are stored in either order (swipe/accept don't sort) — delete
    // both, or "remove buddy" silently did nothing half the time
    await prisma.match.deleteMany({
      where: { OR: [{ userAId: myId, userBId: buddyId }, { userAId: buddyId, userBId: myId }] },
    });
    // Clear the likes too: re-matching needs two fresh likes (otherwise
    // remove → like again re-created the match and paid match XP every time)
    await prisma.swipe.deleteMany({
      where: { OR: [{ swiperId: myId, swipedId: buddyId }, { swiperId: buddyId, swipedId: myId }] },
    });
    return res_.success(res, null, 'Buddy removed');
  } catch (e) { next(e); }
};

// ── SWIPE (like/skip/super_like) ─────────────────────────
// POST /api/match/swipe  { targetId, action }
const swipe = async (req, res, next) => {
  try {
    const { targetId, action = 'like' } = req.body;
    const userId = req.user.id;

    if (!targetId) return res_.error(res, 'targetId required', 422);
    if (userId === targetId) return res_.error(res, 'Cannot swipe yourself', 400);
    if (await isBlockedBetween(userId, targetId)) return res_.error(res, 'User not found', 404);

    // Get target user
    const target = await prisma.user.findUnique({
      where:  { id: targetId },
      select: { id: true, firstName: true, isInfluencer: true, subscriptionPlan: true },
    });
    if (!target) return res_.error(res, 'User not found', 404);
    const previous = await prisma.swipe.findUnique({
      where: { swiperId_swipedId: { swiperId: userId, swipedId: targetId } },
      select: { action: true },
    });
    const alreadyLiked = previous && ['like', 'super_like'].includes(previous.action);

    // ── ELITE CHECK — Influencer match requires Elite plan (like AND super-like) ─
    if (action === 'like' || action === 'super_like') {
      const gate = await influencerGate(req, targetId, target);
      if (gate) return res_.error(res, gate.message, gate.status, gate.extra);
    }

    // Daily like limit (likes + super-likes; skips are free) — counted first,
    // atomically, so parallel taps can't go over
    const isLike = action === 'like' || action === 'super_like';
    if (isLike) {
      const daily = await prisma.dailySwipe.upsert({
        where:  { userId_date: { userId, date: appDate() } },
        update: { count: { increment: 1 } },
        create: { id: uuid(), userId, date: appDate(), count: 1 },
      });
      const limit = req.user.subscriptionPlan === 'free' ? DAILY_LIMIT_FREE : DAILY_LIMIT_PRO;
      if (daily.count > limit) {
        return res_.error(res, `Daily like limit (${limit}) reached — upgrade to Pro for unlimited likes`, 429,
          { code: 'DAILY_LIMIT_REACHED' });
      }
    }

    // Record swipe
    await prisma.swipe.upsert({
      where:  { swiperId_swipedId: { swiperId: userId, swipedId: targetId } },
      // re-date super-likes so the daily super-like limit counts them
      update: { action, ...(action === 'super_like' && { createdAt: new Date() }) },
      create: { id: uuid(), swiperId: userId, swipedId: targetId, action },
    });


    // Deduct 1 chat token for a NEW like (to start chat) — never below 0
    if (action === 'like' && !alreadyLiked) {
      await prisma.user.updateMany({
        where: { id: userId, chatTokens: { gt: 0 } },
        data:  { chatTokens: { decrement: 1 } },
      });
    }

    // Check mutual like → create match
    if (action === 'like' || action === 'super_like') {
      const mutual = await prisma.swipe.findFirst({
        where: { swiperId: targetId, swipedId: userId, action: { in: ['like','super_like'] } },
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
              id:      uuid(),
              userAId: userId,
              userBId: targetId,
              status:  'active',
            },
          });

          // Create chat
          const chat = await prisma.chat.create({
            data: {
              id:      uuid(),
              matchId: match.id,
              userAId: userId,
              userBId: targetId,
            },
          });

          // Notify both
          await _notify(userId,  `🤝 You matched with ${target.firstName || 'a new buddy'}!`, 'new_match', { matchId: match.id });
          await _notify(targetId, `🤝 You have a new match!`,          'new_match', { matchId: match.id });

          // chatId lets the app open the chat directly (it was guessing ids)
          return res_.success(res, { matched: true, matchId: match.id, chatId: chat.id }, 'It\'s a match! 🎉');
        }
      }

      // Not mutual yet — notify target of like (match request), only once
      if (!alreadyLiked) await _notify(targetId,
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
        action:   { in: ['like', 'super_like'] },
        swiper:   { status: 'ACTIVE', isBanned: false, ...notBlockedWhere(userId) },
      },
      include: {
        swiper: {
          select: {
            id: true, firstName: true, lastName: true,
            avatarUrl: true, city: true, primaryActivity: true,
            level: true, trustScore: true, isInfluencer: true,
            instagramHandle: true, instagramFollowers: true,
            createdAt: true, experienceLevel: true, bio: true,
            photos: PHOTOS_SELECT,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200, // newest 200 — loading every like ever received doesn't scale
    });
    const likerIds = likes.map(l => l.swiperId);

    // Filter out already matched (only among these likers)
    const existingMatches = await prisma.match.findMany({
      where: {
        OR: [
          { userAId: userId, userBId: { in: likerIds } },
          { userBId: userId, userAId: { in: likerIds } },
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
      where:  { swiperId: userId, swipedId: { in: likerIds } },
      select: { swipedId: true },
    });
    const iSwiped = new Set(mySwipes.map(s => s.swipedId));

    const pendingRequests = likes.filter(l =>
      !matchedUserIds.has(l.swiperId) &&
      !iSwiped.has(l.swiperId)         // I haven't swiped them back yet
    );

    return res_.success(res, {
      requests: pendingRequests.map(l => ({
        swipeId:    l.id,
        user:       {
          ...l.swiper,
          trustScore: Number(l.swiper.trustScore),
          photos: (l.swiper.photos || []).map(p => p.url),
        },
        isSuperLike: l.action === 'super_like',
        createdAt:  l.createdAt,
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
    const userId      = req.user.id;

    const swipe = await prisma.swipe.findUnique({ where: { id: swipeId } });
    // A "skip" is not a request — accepting it would match you with someone who passed on you
    if (!swipe || !['like', 'super_like'].includes(swipe.action)) {
      return res_.error(res, 'Request not found', 404);
    }
    if (swipe.swipedId !== userId)
      return res_.error(res, 'Not your request', 403);

    const fromUserId = swipe.swiperId;
    if (await isBlockedBetween(userId, fromUserId)) return res_.error(res, 'Request not found', 404);
    const existing = await prisma.match.findFirst({
      where: { OR: [{ userAId: fromUserId, userBId: userId }, { userAId: userId, userBId: fromUserId }] },
      select: { id: true, status: true },
    });
    if (existing) return res_.error(res, 'You are already buddies', 409, { matchId: existing.id });

    // Create match
    const match = await prisma.match.create({
      data: {
        id:      uuid(),
        userAId: fromUserId,
        userBId: userId,
        status:  'active',
      },
    });

    // Create chat
    const chat = await prisma.chat.create({
      data: {
        id:      uuid(),
        matchId: match.id,
        userAId: fromUserId,
        userBId: userId,
      },
    });

    // Record my swipe too
    await prisma.swipe.upsert({
      where:  { swiperId_swipedId: { swiperId: userId, swipedId: fromUserId } },
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
      chatId:  chat.id,
    }, 'Match accepted! 🎉');
  } catch (e) { next(e); }
};

// ── DECLINE MATCH REQUEST ─────────────────────────────────
// POST /api/match/requests/:swipeId/decline
const declineRequest = async (req, res, next) => {
  try {
    const { swipeId } = req.params;
    const userId      = req.user.id;

    const swipe = await prisma.swipe.findUnique({ where: { id: swipeId } });
    if (!swipe) return res_.error(res, 'Request not found', 404);
    if (swipe.swipedId !== userId)
      return res_.error(res, 'Not your request', 403);

    // Record my decline swipe
    await prisma.swipe.upsert({
      where:  { swiperId_swipedId: { swiperId: userId, swipedId: swipe.swiperId } },
      update: { action: 'skip' },
      create: { id: uuid(), swiperId: userId, swipedId: swipe.swiperId, action: 'skip' },
    });

    return res_.success(res, {}, 'Request declined');
  } catch (e) { next(e); }
};

// ── Boost ─────────────────────────────────────────────────
// POST /match/boost  — costs 5 tokens, boosts for 30 min
const boost = async (req, res, next) => {
  try {
    const BOOST_COST_TOKENS = 5;
    const BOOST_DURATION_MS = 30 * 60 * 1000; // 30 minutes

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, chatTokens: true, boostExpiresAt: true },
    });

    if (!user) return res_.error(res, 'User not found', 404);

    // Check if already boosted
    if (user.boostExpiresAt && user.boostExpiresAt > new Date()) {
      const remaining = Math.round((user.boostExpiresAt - Date.now()) / 60000);
      return res_.error(res, `Already boosted — ${remaining} min remaining`, 400);
    }

    // Check tokens
    if (user.chatTokens < BOOST_COST_TOKENS) {
      return res_.error(res, `Not enough tokens (need ${BOOST_COST_TOKENS}, have ${user.chatTokens})`, 402);
    }

    const now = new Date();
    const boostExpiresAt = new Date(now.getTime() + BOOST_DURATION_MS);

    // Atomic: pay + boost only if still enough tokens and not boosted
    // (5 parallel taps used to charge 5× and go negative)
    const claim = await prisma.user.updateMany({
      where: {
        id: req.user.id,
        chatTokens: { gte: BOOST_COST_TOKENS },
        OR: [{ boostExpiresAt: null }, { boostExpiresAt: { lte: now } }],
      },
      data: { chatTokens: { decrement: BOOST_COST_TOKENS }, boostExpiresAt },
    });
    if (claim.count === 0) return res_.error(res, 'Already boosted or not enough tokens', 409);

    return res_.success(res, {
      boostExpiresAt,
      tokensRemaining: user.chatTokens - BOOST_COST_TOKENS,
      durationMinutes: 30,
    }, 'Profile boosted for 30 minutes!');
  } catch (e) { next(e); }
};

// GET /match/boost/status
const boostStatus = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { boostExpiresAt: true, chatTokens: true },
    });

    const now       = new Date();
    const isActive  = user.boostExpiresAt && user.boostExpiresAt > now;
    const remaining = isActive ? Math.round((user.boostExpiresAt - now) / 60000) : 0;

    return res_.success(res, {
      isActive,
      boostExpiresAt:   isActive ? user.boostExpiresAt : null,
      remainingMinutes: remaining,
      tokens:           user.chatTokens,
    });
  } catch (e) { next(e); }
};

// ── Super Like daily limit (middleware for POST /match/swipe) ──
// Referenced by routes/index.js but was never defined → Express threw
// "Route.post() requires a callback function" at boot.
const SUPER_LIKE_LIMIT_FREE = 1;
const SUPER_LIKE_LIMIT_PAID = 5;
const checkSuperLikeLimit = async (req, res, next) => {
  try {
    if (req.body?.action !== 'super_like') return next();
    const limit = req.user.subscriptionPlan === 'free'
      ? SUPER_LIKE_LIMIT_FREE
      : SUPER_LIKE_LIMIT_PAID;
    // Atomic daily counter (count-then-write let parallel taps exceed the limit)
    const date = appDate();
    await prisma.dailySwipe.upsert({
      where:  { userId_date: { userId: req.user.id, date } },
      update: {},
      create: { id: uuid(), userId: req.user.id, date, count: 0, superLikes: 0 },
    }).catch(() => {}); // parallel create → unique clash is fine
    const claim = await prisma.dailySwipe.updateMany({
      where: { userId: req.user.id, date, superLikes: { lt: limit } },
      data:  { superLikes: { increment: 1 } },
    });
    if (claim.count === 0) {
      return res_.error(res,
        `Daily Super Like limit reached (${limit}/day).`
          + (req.user.subscriptionPlan === 'free' ? ' Upgrade for more.' : ''),
        429, { code: 'SUPER_LIKE_LIMIT_REACHED', limit });
    }
    return next();
  } catch (e) { next(e); }
};

// ── Helper ────────────────────────────────────────────────
// Uses the notification service (valid type, push, quiet hours, daily cap)
const _notify = (userId, message, kind, data = {}) =>
  require('../services/notification.service').notifyKind(userId, kind, message, data).catch(() => null);


module.exports = {
  discover, like,
  skip, getBuddies,
  removeBuddy, swipe,
  getMatchRequests,
  acceptRequest, declineRequest,
  boost, boostStatus,
  checkSuperLikeLimit,
};
