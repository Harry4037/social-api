// ─────────────────────────────────────────────────────────
//  DISCOVER CONTROLLER
//  src/controllers/discover.controller.js
//
//  Routes:
//    GET  /api/discover/profiles          — swipeable deck
//    POST /api/discover/swipe             — like / skip
//    GET  /api/discover/filters           — user's saved filters
//    PUT  /api/discover/filters           — update filters
//    POST /api/discover/block             — block a user
//    POST /api/discover/report            — report a user
// ─────────────────────────────────────────────────────────
'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Compatibility algorithm weights (keep private) ────────
const W = { activity: 0.40, level: 0.25, goals: 0.25, distance: 0.10 };
const LEVEL_ORDER = ['beginner','intermediate','advanced','elite'];
const MAX_DIST_KM = 50;
const DAILY_LIKE_LIMIT_FREE = 5;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function compatibilityScore(viewer, target) {
  // Activity overlap (0-1)
  const vActs = viewer.activities || [];
  const tActs = target.activities || [];
  const shared = vActs.filter(a => tActs.includes(a)).length;
  const actScore = vActs.length
    ? shared / Math.max(vActs.length, tActs.length)
    : 0;

  // Level proximity (0-1)
  const vIdx = LEVEL_ORDER.indexOf(viewer.fitnessLevel) ?? 0;
  const tIdx = LEVEL_ORDER.indexOf(target.fitnessLevel) ?? 0;
  const levelScore = 1 - Math.abs(vIdx - tIdx) / (LEVEL_ORDER.length - 1);

  // Goal overlap (0-1)
  const vGoals = viewer.goals || [];
  const tGoals = target.goals || [];
  const sharedGoals = vGoals.filter(g => tGoals.includes(g)).length;
  const goalScore = vGoals.length
    ? sharedGoals / Math.max(vGoals.length, tGoals.length)
    : 0;

  // Distance score (0-1)  — 0 km = 1.0, 50 km = 0.0
  const distKm =
    viewer.latitude && viewer.longitude && target.latitude && target.longitude
      ? haversineKm(viewer.latitude, viewer.longitude, target.latitude, target.longitude)
      : MAX_DIST_KM;
  const distScore = Math.max(0, 1 - distKm / MAX_DIST_KM);

  const total =
    W.activity * actScore +
    W.level    * levelScore +
    W.goals    * goalScore  +
    W.distance * distScore;

  return { score: Math.round(total * 100), distKm: Math.round(distKm * 10) / 10 };
}

// ── GET /api/discover/profiles ────────────────────────────
exports.getProfiles = async (req, res) => {
  try {
    const viewer = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: {
        id: true, activities: true, fitnessLevel: true, goals: true,
        gender: true, latitude: true, longitude: true,
        subscriptionPlan: true,
        blockedUsers: { select: { blockedId: true } },
        swipes:       { select: { swipedId: true } },
      },
    });

    if (!viewer) return res.status(404).json({ message: 'User not found' });

    const {
      activity, level, maxDistance = MAX_DIST_KM,
      genderFilter,          // 'female_only' | null
    } = req.query;

    // IDs to exclude: already swiped + blocked
    const excludeIds = [
      req.user.id,
      ...viewer.swipes.map(s => s.swipedId),
      ...viewer.blockedUsers.map(b => b.blockedId),
    ];

    const where = {
      id:         { notIn: excludeIds },
      isActive:   true,
      isVerified: true,
    };

    // Gender filter — female-only mode
    if (genderFilter === 'female_only' || viewer.gender === 'female') {
      if (genderFilter === 'female_only') where.gender = 'female';
    }

    // Activity filter
    if (activity) where.activities = { has: activity };

    // Level filter
    if (level) where.fitnessLevel = level;

    const candidates = await prisma.user.findMany({
      where,
      select: {
        id: true, firstName: true, lastName: true, avatar: true,
        bio: true, activities: true, fitnessLevel: true, goals: true,
        gender: true, latitude: true, longitude: true,
        subscriptionPlan: true,
        _count: { select: { completedSessions: true, matches: true } },
        trustScore: true, xpPoints: true, level: true, levelName: true,
      },
      take: 100,
    });

    // Score, filter by distance, sort
    const scored = candidates
      .map(c => {
        const { score, distKm } = compatibilityScore(viewer, c);
        return { ...c, compatibilityScore: score, distanceKm: distKm };
      })
      .filter(c => c.distanceKm <= parseFloat(maxDistance))
      .sort((a, b) => b.compatibilityScore - a.compatibilityScore)
      .slice(0, 20)  // return top 20 per load
      .map(c => ({
        id:                c.id,
        firstName:         c.firstName,
        lastName:          c.lastName[0] + '.',  // privacy — last initial only
        avatar:            c.avatar,
        bio:               c.bio,
        activities:        c.activities,
        fitnessLevel:      c.fitnessLevel,
        goals:             c.goals,
        distanceKm:        c.distanceKm,
        compatibilityScore:c.compatibilityScore,
        trustScore:        c.trustScore,
        xpPoints:          c.xpPoints,
        level:             c.level,
        levelName:         c.levelName,
        sessionCount:      c._count.completedSessions,
        plan:              c.subscriptionPlan,
      }));

    res.json({ profiles: scored, total: scored.length });
  } catch (err) {
    console.error('getProfiles error:', err);
    res.status(500).json({ message: 'Failed to load profiles' });
  }
};

// ── POST /api/discover/swipe ──────────────────────────────
exports.swipe = async (req, res) => {
  try {
    const { swipedUserId, direction } = req.body; // direction: 'like' | 'skip' | 'superlike'
    if (!swipedUserId || !['like','skip','superlike'].includes(direction)) {
      return res.status(400).json({ message: 'swipedUserId and direction required' });
    }

    const viewer = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { subscriptionPlan: true, dailyLikesUsed: true, dailyLikesReset: true },
    });

    // Enforce daily like limit for free users
    if (direction === 'like' || direction === 'superlike') {
      if (viewer.subscriptionPlan === 'FREE') {
        const today = new Date().toDateString();
        const resetDay = viewer.dailyLikesReset
          ? new Date(viewer.dailyLikesReset).toDateString()
          : null;
        const usedToday = resetDay === today ? viewer.dailyLikesUsed : 0;

        if (usedToday >= DAILY_LIKE_LIMIT_FREE) {
          return res.status(429).json({
            message:  'Daily swipe limit reached',
            code:     'DAILY_LIMIT_REACHED',
            limit:    DAILY_LIKE_LIMIT_FREE,
            upgradeRequired: true,
          });
        }

        await prisma.user.update({
          where: { id: req.user.id },
          data: {
            dailyLikesUsed:  resetDay === today ? { increment: 1 } : 1,
            dailyLikesReset: resetDay === today ? undefined : new Date(),
          },
        });
      }
    }

    // Record the swipe
    await prisma.swipe.upsert({
      where:  { swiperId_swipedId: { swiperId: req.user.id, swipedId: swipedUserId } },
      create: { swiperId: req.user.id, swipedId: swipedUserId, direction },
      update: { direction },
    });

    // Check for mutual like → create match
    let matchCreated = null;
    if (direction === 'like' || direction === 'superlike') {
      const theirSwipe = await prisma.swipe.findUnique({
        where: { swiperId_swipedId: { swiperId: swipedUserId, swipedId: req.user.id } },
      });

      if (theirSwipe && ['like','superlike'].includes(theirSwipe.direction)) {
        // Check no existing match
        const existing = await prisma.match.findFirst({
          where: {
            OR: [
              { user1Id: req.user.id, user2Id: swipedUserId },
              { user1Id: swipedUserId, user2Id: req.user.id },
            ],
          },
        });

        if (!existing) {
          const match = await prisma.match.create({
            data: {
              user1Id: req.user.id,
              user2Id: swipedUserId,
              status: 'ACTIVE',
            },
          });

          // Award XP to both users
          await prisma.user.updateMany({
            where: { id: { in: [req.user.id, swipedUserId] } },
            data:  { xpPoints: { increment: 30 } },
          });

          matchCreated = { matchId: match.id, isMatch: true };
        }
      }
    }

    res.json({ success: true, ...(matchCreated || { isMatch: false }) });
  } catch (err) {
    console.error('swipe error:', err);
    res.status(500).json({ message: 'Swipe failed' });
  }
};

// ── POST /api/discover/block ──────────────────────────────
exports.blockUser = async (req, res) => {
  try {
    const { targetUserId, reason } = req.body;
    if (!targetUserId) return res.status(400).json({ message: 'targetUserId required' });

    await prisma.userBlock.upsert({
      where:  { blockerId_blockedId: { blockerId: req.user.id, blockedId: targetUserId } },
      create: { blockerId: req.user.id, blockedId: targetUserId, reason: reason || null },
      update: {},
    });

    // Also remove any existing match
    await prisma.match.updateMany({
      where: {
        OR: [
          { user1Id: req.user.id, user2Id: targetUserId },
          { user1Id: targetUserId, user2Id: req.user.id },
        ],
      },
      data: { status: 'BLOCKED' },
    });

    res.json({ success: true, message: 'User blocked' });
  } catch (err) {
    console.error('blockUser error:', err);
    res.status(500).json({ message: 'Block failed' });
  }
};

// ── POST /api/discover/report ─────────────────────────────
exports.reportUser = async (req, res) => {
  try {
    const { targetUserId, reason, description } = req.body;
    if (!targetUserId || !reason) {
      return res.status(400).json({ message: 'targetUserId and reason required' });
    }

    const VALID_REASONS = ['spam','inappropriate','fake_profile','harassment','safety_concern','other'];
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({ message: 'Invalid reason', validReasons: VALID_REASONS });
    }

    await prisma.userReport.create({
      data: {
        reporterId:  req.user.id,
        reportedId:  targetUserId,
        reason,
        description: description || null,
        status:      'PENDING',
      },
    });

    // Auto-block after report for reporter's safety
    await prisma.userBlock.upsert({
      where:  { blockerId_blockedId: { blockerId: req.user.id, blockedId: targetUserId } },
      create: { blockerId: req.user.id, blockedId: targetUserId, reason: `auto_block_after_report:${reason}` },
      update: {},
    });

    res.json({ success: true, message: 'Report submitted. User has been blocked for your safety.' });
  } catch (err) {
    console.error('reportUser error:', err);
    res.status(500).json({ message: 'Report failed' });
  }
};

// ── GET /api/discover/filters ─────────────────────────────
exports.getFilters = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { discoverFilters: true },
    });
    res.json({ filters: user?.discoverFilters || {} });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load filters' });
  }
};

// ── PUT /api/discover/filters ─────────────────────────────
exports.updateFilters = async (req, res) => {
  try {
    const { activity, level, maxDistance, genderFilter } = req.body;
    const filters = {};
    if (activity)    filters.activity    = activity;
    if (level)       filters.level       = level;
    if (maxDistance) filters.maxDistance = parseInt(maxDistance, 10);
    if (genderFilter !== undefined) filters.genderFilter = genderFilter;

    await prisma.user.update({
      where: { id: req.user.id },
      data:  { discoverFilters: filters },
    });

    res.json({ success: true, filters });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update filters' });
  }
};
