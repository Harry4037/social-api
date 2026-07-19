// ─────────────────────────────────────────────────────────
//  adminChallenge.controller.js  (V2)
//  CRUD for challenges + stations. Admin only.
// ─────────────────────────────────────────────────────────
'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /admin/challenges
exports.list = async (req, res) => {
  try {
    const { page = 1, limit = 20, tier, type, active } = req.query;
    const where = {};
    if (tier   !== undefined) where.tier     = Number(tier);
    if (type   !== undefined) where.type     = type;
    if (active !== undefined) where.isActive = active === 'true';

    const [challenges, total] = await Promise.all([
      prisma.challenge.findMany({
        where,
        include: {
          stations: { orderBy: { stationNum: 'asc' } },
          _count: { select: { entries: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.challenge.count({ where }),
    ]);

    res.json({
      challenges: challenges.map(c => ({
        ...c,
        participantCount: c._count.entries,
        _count: undefined,
      })),
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list challenges' });
  }
};

// POST /admin/challenges
exports.create = async (req, res) => {
  try {
    const {
      title, description, type, tier, cityId,
      startAt, endAt, xpPool,
      entryLevelRequired = 1, trustRequired = 0,
      maxParticipants,
      stations = [],
    } = req.body;

    const challenge = await prisma.challenge.create({
      data: {
        title, description, type, tier: Number(tier),
        cityId: cityId || null,
        startAt: new Date(startAt),
        endAt:   new Date(endAt),
        xpPool:  Number(xpPool),
        entryLevelRequired: Number(entryLevelRequired),
        trustRequired:      Number(trustRequired),
        maxParticipants: maxParticipants ? Number(maxParticipants) : null,
        isActive: true,
        stations: {
          create: stations.map((s, i) => ({
            stationNum:   i + 1,
            title:        s.title,
            description:  s.description,
            verifyType:   s.verifyType  || 'count',
            targetValue:  Number(s.targetValue) || 1,
            buddyRequired: s.buddyRequired === true,
            xpReward:     Number(s.xpReward) || 0,
          })),
        },
      },
      include: { stations: { orderBy: { stationNum: 'asc' } } },
    });

    res.status(201).json({ challenge });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create challenge' });
  }
};

// PATCH /admin/challenges/:id
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, isActive, endAt, xpPool } = req.body;
    const data = {};
    if (title       !== undefined) data.title     = title;
    if (description !== undefined) data.description = description;
    if (isActive    !== undefined) data.isActive   = Boolean(isActive);
    if (endAt       !== undefined) data.endAt      = new Date(endAt);
    if (xpPool      !== undefined) data.xpPool     = Number(xpPool);

    const challenge = await prisma.challenge.update({
      where: { id },
      data,
      include: { stations: { orderBy: { stationNum: 'asc' } }, _count: { select: { entries: true } } },
    });
    res.json({ challenge: { ...challenge, participantCount: challenge._count.entries, _count: undefined } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update challenge' });
  }
};

// DELETE /admin/challenges/:id
exports.remove = async (req, res) => {
  try {
    await prisma.challenge.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate challenge' });
  }
};

// GET /admin/challenges/:id/entries
exports.getEntries = async (req, res) => {
  try {
    const entries = await prisma.challengeEntry.findMany({
      where: { challengeId: req.params.id },
      include: {
        user:  { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        buddy: { select: { firstName: true, lastName: true } },
        completions: true,
      },
      orderBy: [{ totalXpEarned: 'desc' }],
    });
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
};
