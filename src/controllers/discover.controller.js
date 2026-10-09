// ─────────────────────────────────────────────────────────
//  DISCOVER CONTROLLER
//  src/controllers/discover.controller.js
//
//  Routes:
//    GET  /api/discover/profiles          — swipeable deck
//    POST /api/discover/swipe             — like / skip / superlike
//    GET  /api/discover/filters           — user's saved filters
//    PUT  /api/discover/filters           — update filters
//    POST /api/discover/block             — block a user
//    POST /api/discover/report            — report a user
//
//  Schema notes:
//    - Swipe fields: swiperId, swipedId, action (SwipeAction enum)
//    - Match fields: userAId, userBId, status (lowercase: 'active')
//    - User swipe relation: swipesGiven (NOT swipes)
//    - No UserBlock or UserReport models — block via Swipe action:'block';
//      report is logged to console (structured) pending a UserReport migration.
//    - User fields: status (NOT isActive), idVerified (NOT isVerified),
//      experienceLevel (NOT fitnessLevel), xpTotal (NOT xpPoints),
//      avatarUrl (NOT avatar)
//    - No discoverFilters on User schema — filters are stored in-memory
//      per-process (session-scoped). To persist, add `discoverFilters Json?`
//      to the User model and swap in the prisma.user.update call below.
//    - activities is a Json field — filter in-memory after fetching candidates.
//    - DailySwipe.date is a String — use ISO date slice '2024-01-15'.
// ─────────────────────────────────────────────────────────
'use strict';

const prisma = require('../config/db');

// ── In-memory filter store (replace with DB column when schema allows) ────
// TODO: Add `discoverFilters Json?` to User model in schema.prisma, then
// replace the _filterStore reads/writes below with prisma.user CRUD.
const _filterStore = new Map(); // userId → filters object

// ── Compatibility algorithm weights ───────────────────────
const W = { activity: 0.40, level: 0.25, goals: 0.25, distance: 0.10 };
const LEVEL_ORDER = ['beginner', 'intermediate', 'advanced', 'elite'];
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
  // Activity overlap (0-1) — activities is a Json array; coerce to Array
  const vActs = Array.isArray(viewer.activities) ? viewer.activities : [];
  const tActs = Array.isArray(target.activities) ? target.activities : [];
  const shared = vActs.filter(a => tActs.includes(a)).length;
  const actScore = vActs.length
    ? shared / Math.max(vActs.length, tActs.length)
    : 0;

  // Level proximity (0-1) — field is experienceLevel
  const vIdx = Math.max(0, LEVEL_ORDER.indexOf(viewer.experienceLevel));
  const tIdx = Math.max(0, LEVEL_ORDER.indexOf(target.experienceLevel));
  const levelScore = 1 - Math.abs(vIdx - tIdx) / (LEVEL_ORDER.length - 1);

  // Goal overlap (0-1)
  const vGoals = Array.isArray(viewer.goals) ? viewer.goals : [];
  const tGoals = Array.isArray(target.goals) ? target.goals : [];
  const sharedGoals = vGoals.filter(g => tGoals.includes(g)).length;
  const goalScore = vGoals.length
    ? sharedGoals / Math.max(vGoals.length, tGoals.length)
    : 0;

  // Distance score (0-1) — 0 km = 1.0, MAX_DIST_KM = 0.0
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
        id: true, activities: true, experienceLevel: true, goals: true,
        gender: true, latitude: true, longitude: true,
        subscriptionPlan: true,
        // swipesGiven gives all IDs already acted on — exclude them from deck
        swipesGiven: { select: { swipedId: true } },
      },
    });

    if (!viewer) return res.status(404).json({ message: 'User not found' });

    const {
      activity,
      level,
      maxDistance = MAX_DIST_KM,
      genderFilter,
    } = req.query;

    // IDs to exclude: self + already swiped
    const excludeIds = [
      req.user.id,
      ...viewer.swipesGiven.map(s => s.swipedId),
    ];

    // Also exclude anyone the viewer has "blocked" via a block-action swipe
    const blockSwipes = await prisma.swipe.findMany({
      where:  { swiperId: req.user.id, action: 'block' },
      select: { swipedId: true },
    });
    blockSwipes.forEach(b => excludeIds.push(b.swipedId));

    const where = {
      id:         { notIn: excludeIds },
      status:     'active',    // User.status field (NOT isActive)
      idVerified: true,        // User.idVerified field (NOT isVerified)
    };

    // Gender filter
    if (genderFilter === 'female_only') where.gender = 'female';

    // Level filter — experienceLevel field
    if (level) where.experienceLevel = level;

    // NOTE: `activities` is a Json field — Prisma does not support `has` on
    // Json in all providers. We fetch a broader set and filter in-memory.
    const candidates = await prisma.user.findMany({
      where,
      select: {
        id: true, firstName: true, lastName: true, avatarUrl: true,
        bio: true, activities: true, experienceLevel: true, goals: true,
        gender: true, latitude: true, longitude: true,
        subscriptionPlan: true,
        _count: { select: { completedSessions: true } },
        trustScore: true, xpTotal: true, level: true, levelName: true,
      },
      take: 200, // fetch extra to allow in-memory filtering
    });

    // In-memory activity filter
    const activityFilter = activity || null;
    const filtered = activityFilter
      ? candidates.filter(c => {
          const acts = Array.isArray(c.activities) ? c.activities : [];
          return acts.includes(activityFilter);
        })
      : candidates;

    // Score, filter by distance, sort
    const maxDist = parseFloat(maxDistance);
    const scored = filtered
      .map(c => {
        const { score, distKm } = compatibilityScore(viewer, c);
        return { ...c, compatibilityScore: score, distanceKm: distKm };
      })
      .filter(c => c.distanceKm <= maxDist)
      .sort((a, b) => b.compatibilityScore - a.compatibilityScore)
      .slice(0, 20)
      .map(c => ({
        id:                 c.id,
        firstName:          c.firstName,
        lastName:           c.lastName ? c.lastName[0] + '.' : '',
        avatarUrl:          c.avatarUrl,
        bio:                c.bio,
        activities:         c.activities,
        experienceLevel:    c.experienceLevel,
        goals:              c.goals,
        distanceKm:         c.distanceKm,
        compatibilityScore: c.compatibilityScore,
        trustScore:         c.trustScore,
        xpTotal:            c.xpTotal,
        level:              c.level,
        levelName:          c.levelName,
        sessionCount:       c._count.completedSessions,
        plan:               c.subscriptionPlan,
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
    const { swipedUserId, action } = req.body; // action: 'like' | 'skip' | 'superlike'
    if (!swipedUserId || !['like', 'skip', 'superlike'].includes(action)) {
      return res.status(400).json({
        message: 'swipedUserId and action (like|skip|superlike) required',
      });
    }

    const viewer = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { subscriptionPlan: true },
    });

    if (!viewer) return res.status(404).json({ message: 'User not found' });

    // ── Enforce daily like limit for free users via DailySwipe ────────────
    if (action === 'like' || action === 'superlike') {
      if (viewer.subscriptionPlan === 'FREE') {
        const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

        const dailyRecord = await prisma.dailySwipe.findUnique({
          where: { userId_date: { userId: req.user.id, date: today } },
        });

        const usedToday = dailyRecord ? dailyRecord.count : 0;

        if (usedToday >= DAILY_LIKE_LIMIT_FREE) {
          return res.status(429).json({
            message:         'Daily swipe limit reached',
            code:            'DAILY_LIMIT_REACHED',
            limit:           DAILY_LIKE_LIMIT_FREE,
            upgradeRequired: true,
          });
        }

        // Upsert DailySwipe counter
        await prisma.dailySwipe.upsert({
          where:  { userId_date: { userId: req.user.id, date: today } },
          create: { userId: req.user.id, date: today, count: 1 },
          update: { count: { increment: 1 } },
        });
      }
    }

    // ── Record the swipe ───────────────────────────────────────────────────
    await prisma.swipe.upsert({
      where:  { swiperId_swipedId: { swiperId: req.user.id, swipedId: swipedUserId } },
      create: { swiperId: req.user.id, swipedId: swipedUserId, action },
      update: { action },
    });

    // ── Check for mutual like → create Match ──────────────────────────────
    let matchCreated = null;
    if (action === 'like' || action === 'superlike') {
      const theirSwipe = await prisma.swipe.findUnique({
        where: { swiperId_swipedId: { swiperId: swipedUserId, swipedId: req.user.id } },
      });

      if (theirSwipe && ['like', 'superlike'].includes(theirSwipe.action)) {
        // Ensure consistent ordering (smaller id is userA)
        const [userAId, userBId] =
          req.user.id < swipedUserId
            ? [req.user.id, swipedUserId]
            : [swipedUserId, req.user.id];

        const existing = await prisma.match.findFirst({
          where: { userAId, userBId },
        });

        if (!existing) {
          const match = await prisma.match.create({
            data: { userAId, userBId, status: 'active' },
          });

          // Award XP to both users (xpTotal field)
          await prisma.user.updateMany({
            where: { id: { in: [req.user.id, swipedUserId] } },
            data:  { xpTotal: { increment: 30 } },
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
// No UserBlock model exists. We record a Swipe with action:'block', which
// naturally excludes the target from the viewer's deck via swipesGiven.
exports.blockUser = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    if (!targetUserId) return res.status(400).json({ message: 'targetUserId required' });

    // Record block as a swipe action
    await prisma.swipe.upsert({
      where:  { swiperId_swipedId: { swiperId: req.user.id, swipedId: targetUserId } },
      create: { swiperId: req.user.id, swipedId: targetUserId, action: 'block' },
      update: { action: 'block' },
    });

    // Deactivate any existing match between the two users
    const [userAId, userBId] =
      req.user.id < targetUserId
        ? [req.user.id, targetUserId]
        : [targetUserId, req.user.id];

    await prisma.match.updateMany({
      where: { userAId, userBId },
      data:  { status: 'unmatched' },
    });

    res.json({ success: true, message: 'User blocked' });
  } catch (err) {
    console.error('blockUser error:', err);
    res.status(500).json({ message: 'Block failed' });
  }
};

// ── POST /api/discover/report ─────────────────────────────
// No UserReport model exists. Reports are structured-logged server-side
// pending a schema migration. After adding a UserReport model, replace the
// console.error call with prisma.userReport.create(...).
// We also auto-block the reported user for the reporter's safety.
const VALID_REPORT_REASONS = [
  'spam', 'inappropriate', 'fake_profile', 'harassment', 'safety_concern', 'other',
];

exports.reportUser = async (req, res) => {
  try {
    const { targetUserId, reason, description } = req.body;
    if (!targetUserId || !reason) {
      return res.status(400).json({ message: 'targetUserId and reason required' });
    }

    if (!VALID_REPORT_REASONS.includes(reason)) {
      return res.status(400).json({
        message:      'Invalid reason',
        validReasons: VALID_REPORT_REASONS,
      });
    }

    // Structured log — replace with DB write once UserReport model is added
    // TODO: add `model UserReport` to schema.prisma and migrate
    console.error(JSON.stringify({
      type:        'USER_REPORT',
      reporterId:  req.user.id,
      reportedId:  targetUserId,
      reason,
      description: description || null,
      timestamp:   new Date().toISOString(),
    }));

    // Auto-block: record a block swipe so the reported user disappears from deck
    await prisma.swipe.upsert({
      where:  { swiperId_swipedId: { swiperId: req.user.id, swipedId: targetUserId } },
      create: { swiperId: req.user.id, swipedId: targetUserId, action: 'block' },
      update: { action: 'block' },
    });

    // Deactivate any existing match
    const [userAId, userBId] =
      req.user.id < targetUserId
        ? [req.user.id, targetUserId]
        : [targetUserId, req.user.id];

    await prisma.match.updateMany({
      where: { userAId, userBId },
      data:  { status: 'unmatched' },
    });

    res.json({ success: true, message: 'Report submitted. User has been blocked for your safety.' });
  } catch (err) {
    console.error('reportUser error:', err);
    res.status(500).json({ message: 'Report failed' });
  }
};

// ── GET /api/discover/filters ─────────────────────────────
// Filters are stored in _filterStore (in-memory) because the User schema has
// no `discoverFilters` column yet.
// TODO: add `discoverFilters Json?` to User in schema.prisma, then read with:
//   const user = await prisma.user.findUnique({ where: { id: req.user.id },
//     select: { discoverFilters: true } });
//   res.json({ filters: user?.discoverFilters || {} });
exports.getFilters = async (req, res) => {
  try {
    const filters = _filterStore.get(req.user.id) || {};
    res.json({ filters });
  } catch (err) {
    console.error('getFilters error:', err);
    res.status(500).json({ message: 'Failed to load filters' });
  }
};

// ── PUT /api/discover/filters ─────────────────────────────
exports.updateFilters = async (req, res) => {
  try {
    const { activity, level, maxDistance, genderFilter } = req.body;
    const existing = _filterStore.get(req.user.id) || {};
    const filters = { ...existing };

    if (activity    !== undefined) filters.activity    = activity;
    if (level       !== undefined) filters.level       = level;
    if (maxDistance !== undefined) filters.maxDistance = parseInt(maxDistance, 10);
    if (genderFilter !== undefined) filters.genderFilter = genderFilter;

    _filterStore.set(req.user.id, filters);

    // TODO: persist when discoverFilters column exists:
    // await prisma.user.update({ where: { id: req.user.id },
    //   data: { discoverFilters: filters } });

    res.json({ success: true, filters });
  } catch (err) {
    console.error('updateFilters error:', err);
    res.status(500).json({ message: 'Failed to update filters' });
  }
};
