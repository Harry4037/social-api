// ─────────────────────────────────────────────────────────
//  challenge.controller.js  (V2 — fixed response envelope)
//
//  All responses now use the standard { success: true, data: {...} }
//  envelope so the Flutter ApiService._data() helper can unwrap them.
//
//  GET /challenges      → { success, data: { challenges: [...] } }
//  GET /challenges/my   → { success, data: { entries: [...] } }
//  GET /challenges/:id  → { success, data: { challenge: {...} } }
//  POST /challenges/:id/join → { success, data: { entry: {...} } }
//  GET /challenges/:id/feed  → { success, data: { posts: [...] } }
//  GET /leaderboard          → { success, data: { entries: [...] } }
// ─────────────────────────────────────────────────────────
'use strict';
const { PrismaClient } = require('@prisma/client');
const { success, created, error } = require('../utils/response');
const prisma = new PrismaClient();

// ── GET /challenges?tier=&type=&city= ─────────────────────
exports.getChallenges = async (req, res) => {
  try {
    const { tier, type, city, environment } = req.query;
    const where = { isActive: true };
    if (tier)        where.tier        = Number(tier);
    if (type)        where.type        = type;
    if (city)        where.cityId      = city;
    if (environment) where.environment = environment;

    const challenges = await prisma.challenge.findMany({
      where,
      include: {
        stations: { orderBy: { stationNum: 'asc' } },
        _count:   { select: { entries: true } },
        entries:  req.user ? {
          where:   { userId: req.user.id },
          include: { completions: true },
          take:    1,
        } : false,
      },
      orderBy: [{ tier: 'asc' }, { startAt: 'desc' }],
    });

    const shaped = challenges.map(c => ({
      ...c,
      participantCount: c._count.entries,
      myEntry:          c.entries?.[0] ?? null,
      _count:           undefined,
      entries:          undefined,
    }));

    // ✅ Wrapped in standard envelope so Flutter _data() can unwrap it
    return success(res, { challenges: shaped });
  } catch (err) {
    console.error('[getChallenges]', err);
    return error(res, 'Failed to fetch challenges');
  }
};

// ── GET /challenges/my ────────────────────────────────────
exports.getMyChallenges = async (req, res) => {
  try {
    const entries = await prisma.challengeEntry.findMany({
      where:   { userId: req.user.id, status: { in: ['active', 'dormant'] } },
      include: {
        completions: true,
        challenge: {
          include: { stations: { orderBy: { stationNum: 'asc' } } },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return success(res, { entries });
  } catch (err) {
    console.error('[getMyChallenges]', err);
    return error(res, 'Failed to fetch entries');
  }
};

// ── GET /challenges/:id ───────────────────────────────────
exports.getChallenge = async (req, res) => {
  try {
    const challenge = await prisma.challenge.findUnique({
      where: { id: req.params.id },
      include: {
        stations: { orderBy: { stationNum: 'asc' } },
        _count:   { select: { entries: true } },
        entries:  req.user ? {
          where:   { userId: req.user.id },
          include: { completions: true },
          take:    1,
        } : false,
      },
    });

    if (!challenge) return error(res, 'Challenge not found', 404);

    const shaped = {
      ...challenge,
      participantCount: challenge._count.entries,
      myEntry:          challenge.entries?.[0] ?? null,
      _count:           undefined,
      entries:          undefined,
    };

    return success(res, { challenge: shaped });
  } catch (err) {
    console.error('[getChallenge]', err);
    return error(res, 'Failed to fetch challenge');
  }
};

// ── POST /challenges/:id/join ─────────────────────────────
exports.joinChallenge = async (req, res) => {
  try {
    const { id }      = req.params;
    const { buddyId } = req.body;

    const challenge = await prisma.challenge.findUnique({ where: { id } });
    if (!challenge || !challenge.isActive)
      return error(res, 'Challenge not found or inactive', 404);

    // Level check
    if (req.user.level < (challenge.entryLevelRequired || 1))
      return error(res, `Level ${challenge.entryLevelRequired} required to join`, 403);

    // Trust check
    if ((req.user.trustScore || 0) < (challenge.trustRequired || 0))
      return error(res, `Trust score ${challenge.trustRequired}+ required`, 403);

    const existing = await prisma.challengeEntry.findFirst({
      where: { challengeId: id, userId: req.user.id, status: 'active' },
    });
    if (existing) return error(res, 'Already enrolled', 409);

    const entry = await prisma.challengeEntry.create({
      data: {
        challengeId:    id,
        userId:         req.user.id,
        buddyId:        buddyId ?? null,
        status:         'active',
        currentStation: 1,
        totalXpEarned:  0,
      },
      include: { completions: true },
    });

    return created(res, { entry });
  } catch (err) {
    console.error('[joinChallenge]', err);
    return error(res, 'Failed to join challenge');
  }
};

// ── GET /challenges/:id/feed ──────────────────────────────
exports.getChallengeFeed = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const posts = await prisma.challengeFeedPost.findMany({
      where:   { challengeId: req.params.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { postedAt: 'desc' },
      skip:    (Number(page) - 1) * Number(limit),
      take:    Number(limit),
    });

    const shaped = posts.map(p => ({
      ...p,
      displayName: `${p.user.firstName} ${p.user.lastName}`,
      avatarUrl:   p.user.avatarUrl,
      user:        undefined,
    }));

    return success(res, { posts: shaped });
  } catch (err) {
    console.error('[getChallengeFeed]', err);
    return error(res, 'Failed to fetch feed');
  }
};

// ── GET /leaderboard?challengeId=&city= ──────────────────
exports.getLeaderboard = async (req, res) => {
  try {
    const { challengeId, city } = req.query;

    const where = { status: { in: ['active', 'completed'] } };
    if (challengeId) where.challengeId = challengeId;

    const entries = await prisma.challengeEntry.findMany({
      where,
      include: {
        user:  { select: { id: true, firstName: true, lastName: true, avatarUrl: true, city: true } },
        buddy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ totalXpEarned: 'desc' }, { currentStation: 'desc' }],
      take:    50,
    });

    const board = entries
      .filter(e => !city || e.user.city === city)
      .map((e, i) => ({
        rank:              i + 1,
        userId:            e.userId,
        displayName:       `${e.user.firstName} ${e.user.lastName}`,
        avatarUrl:         e.user.avatarUrl,
        city:              e.user.city,
        buddyName:         e.buddy ? `${e.buddy.firstName} ${e.buddy.lastName}` : null,
        xpEarned:          e.totalXpEarned,
        stationsCompleted: e.currentStation - 1,
      }));

    return success(res, { entries: board });
  } catch (err) {
    console.error('[getLeaderboard]', err);
    return error(res, 'Failed to fetch leaderboard');
  }
};

// ── GET /global-leaderboard?period=weekly|monthly|alltime&city= ──
exports.getGlobalLeaderboard = async (req, res) => {
  try {
    const { period = 'alltime', city } = req.query;

    // Build date filter based on period
    let dateFilter = {};
    const now = new Date();
    if (period === 'weekly') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      dateFilter = { updatedAt: { gte: weekAgo } };
    } else if (period === 'monthly') {
      const monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      dateFilter = { updatedAt: { gte: monthAgo } };
    }

    const users = await prisma.user.findMany({
      where: {
        status:   'ACTIVE',
        isBanned: false,
        ...(city && { city }),
        ...dateFilter,
      },
      select: {
        id:              true,
        firstName:       true,
        lastName:        true,
        avatarUrl:       true,
        city:            true,
        xpTotal:         true,
        level:           true,
        primaryActivity: true,
      },
      orderBy: { xpTotal: 'desc' },
      take:    100,
    });

    const board = users.map((u, i) => ({
      rank:            i + 1,
      userId:          u.id,
      displayName:     `${u.firstName} ${u.lastName}`,
      avatarUrl:       u.avatarUrl,
      city:            u.city,
      xpTotal:         u.xpTotal,
      level:           u.level,
      primaryActivity: u.primaryActivity,
    }));

    return success(res, { entries: board, period, city: city || null });
  } catch (err) {
    console.error('[getGlobalLeaderboard]', err);
    return error(res, 'Failed to fetch global leaderboard');
  }
};
