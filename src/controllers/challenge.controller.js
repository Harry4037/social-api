// ─────────────────────────────────────────────────────────
//  challenge.controller.js  (V2)
//  All user-facing challenge endpoints
// ─────────────────────────────────────────────────────────
'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /challenges?tier=&type=&city=
exports.getChallenges = async (req, res) => {
  try {
    const { tier, type, city } = req.query;
    const where = { isActive: true };
    if (tier)  where.tier   = Number(tier);
    if (type)  where.type   = type;
    if (city)  where.cityId = city;

    const challenges = await prisma.challenge.findMany({
      where,
      include: {
        stations: { orderBy: { stationNum: 'asc' } },
        _count: { select: { entries: true } },
        entries: req.user ? {
          where: { userId: req.user.id },
          include: { completions: true },
          take: 1,
        } : false,
      },
      orderBy: [{ tier: 'asc' }, { startAt: 'desc' }],
    });

    const shaped = challenges.map(c => ({
      ...c,
      participantCount: c._count.entries,
      myEntry: c.entries?.[0] ?? null,
      _count: undefined,
      entries: undefined,
    }));

    res.json({ challenges: shaped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch challenges' });
  }
};

// GET /challenges/my
exports.getMyChallenges = async (req, res) => {
  try {
    const entries = await prisma.challengeEntry.findMany({
      where: { userId: req.user.id, status: { in: ['active', 'dormant'] } },
      include: { completions: true, challenge: true },
      orderBy: { joinedAt: 'desc' },
    });
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
};

// GET /challenges/:id
exports.getChallenge = async (req, res) => {
  try {
    const challenge = await prisma.challenge.findUnique({
      where: { id: req.params.id },
      include: {
        stations: { orderBy: { stationNum: 'asc' } },
        _count: { select: { entries: true } },
        entries: req.user ? {
          where: { userId: req.user.id },
          include: { completions: true },
          take: 1,
        } : false,
      },
    });
    if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
    const shaped = {
      ...challenge,
      participantCount: challenge._count.entries,
      myEntry: challenge.entries?.[0] ?? null,
      _count: undefined,
      entries: undefined,
    };
    res.json({ challenge: shaped });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch challenge' });
  }
};

// POST /challenges/:id/join
exports.joinChallenge = async (req, res) => {
  try {
    const { id } = req.params;
    const { buddyId } = req.body;

    const challenge = await prisma.challenge.findUnique({ where: { id } });
    if (!challenge || !challenge.isActive)
      return res.status(404).json({ error: 'Challenge not found or inactive' });

    const existing = await prisma.challengeEntry.findFirst({
      where: { challengeId: id, userId: req.user.id, status: 'active' },
    });
    if (existing) return res.status(409).json({ error: 'Already enrolled' });

    const entry = await prisma.challengeEntry.create({
      data: {
        challengeId: id,
        userId: req.user.id,
        buddyId: buddyId ?? null,
        status: 'active',
        currentStation: 1,
        totalXpEarned: 0,
      },
      include: { completions: true },
    });
    res.status(201).json({ entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join challenge' });
  }
};

// GET /challenges/:id/feed
exports.getChallengeFeed = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const posts = await prisma.challengeFeedPost.findMany({
      where: { challengeId: req.params.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { postedAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    const shaped = posts.map(p => ({
      ...p,
      displayName: `${p.user.firstName} ${p.user.lastName}`,
      avatarUrl: p.user.avatarUrl,
      user: undefined,
    }));
    res.json({ posts: shaped });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
};

// GET /leaderboard?challengeId=&city=
exports.getLeaderboard = async (req, res) => {
  try {
    const { challengeId, city } = req.query;
    const where = { status: { in: ['active', 'completed'] } };
    if (challengeId) where.challengeId = challengeId;
    const entries = await prisma.challengeEntry.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, city: true } },
        buddy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ totalXpEarned: 'desc' }, { currentStation: 'desc' }],
      take: 50,
    });
    const board = entries.map((e, i) => ({
      rank: i + 1,
      userId: e.userId,
      displayName: `${e.user.firstName} ${e.user.lastName}`,
      avatarUrl: e.user.avatarUrl,
      city: e.user.city,
      buddyName: e.buddy ? `${e.buddy.firstName} ${e.buddy.lastName}` : null,
      xpEarned: e.totalXpEarned,
      stationsCompleted: e.currentStation - 1,
    }));
    res.json({ entries: board });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
};
