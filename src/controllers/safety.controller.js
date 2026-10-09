'use strict';
// ─────────────────────────────────────────────────────────
//  safety.controller.js — Block & Report
//
//  User:
//    POST   /safety/block            { userId }
//    DELETE /safety/block/:userId
//    GET    /safety/blocked
//    POST   /safety/report           { userId, reason, details?, context?, block? }
//  Admin (admin.routes.js):
//    GET    /admin/reports?status=open
//    PATCH  /admin/reports/:id       { status, adminNote?, banUser? }
//
//  Blocking is two-way invisible: neither person sees the other in
//  Discover, chats, profiles or the gym map, and they can't message.
// ─────────────────────────────────────────────────────────
const { v4: uuid } = require('uuid');
const prisma = require('../config/db');
const res_   = require('../utils/response');
const logger = require('../config/logger');

const REPORT_REASONS = [
  'harassment', 'fake_profile', 'inappropriate', 'spam', 'safety', 'underage', 'other',
];
// Reports from this many different people in 7 days → flagged as urgent
const URGENT_REPORTERS = 3;

// ── Helper used by other controllers ─────────────────────
// All user ids that I blocked OR who blocked me
const blockedIdsFor = async (userId) => {
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set();
  for (const r of rows) ids.add(r.blockerId === userId ? r.blockedId : r.blockerId);
  return ids;
};

const isBlockedBetween = async (a, b) => {
  const row = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return !!row;
};

// Prisma where-fragment: exclude users blocked in either direction
const notBlockedWhere = (userId) => ({
  blocksReceived: { none: { blockerId: userId } },
  blocksGiven:    { none: { blockedId: userId } },
});

const _doBlock = async (blockerId, blockedId) => {
  await prisma.userBlock.upsert({
    where:  { blockerId_blockedId: { blockerId, blockedId } },
    update: {},
    create: { id: uuid(), blockerId, blockedId },
  });
  // End any match between them (chat disappears from both lists)
  await prisma.match.updateMany({
    where: {
      OR: [
        { userAId: blockerId, userBId: blockedId },
        { userAId: blockedId, userBId: blockerId },
      ],
    },
    data: { status: 'unmatched' },
  }).catch(() => {});
};

// POST /safety/block
const block = async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res_.error(res, 'userId required', 422);
    if (userId === req.user.id) return res_.error(res, 'You cannot block yourself', 400);
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) return res_.error(res, 'User not found', 404);

    await _doBlock(req.user.id, userId);
    return res_.success(res, { blocked: true }, 'User blocked');
  } catch (e) { next(e); }
};

// DELETE /safety/block/:userId
const unblock = async (req, res, next) => {
  try {
    await prisma.userBlock.deleteMany({
      where: { blockerId: req.user.id, blockedId: req.params.userId },
    });
    return res_.success(res, { blocked: false }, 'User unblocked');
  } catch (e) { next(e); }
};

// GET /safety/blocked — people I blocked
const listBlocked = async (req, res, next) => {
  try {
    const rows = await prisma.userBlock.findMany({
      where:   { blockerId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { blocked: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    return res_.success(res, {
      users: rows.map(r => ({
        id:        r.blocked.id,
        name:      `${r.blocked.firstName} ${r.blocked.lastName}`.trim(),
        avatarUrl: r.blocked.avatarUrl,
        blockedAt: r.createdAt,
      })),
    });
  } catch (e) { next(e); }
};

// POST /safety/report
const report = async (req, res, next) => {
  try {
    const { userId, reason, details, context, block: alsoBlock = true } = req.body;
    if (!userId) return res_.error(res, 'userId required', 422);
    if (userId === req.user.id) return res_.error(res, 'You cannot report yourself', 400);
    if (!REPORT_REASONS.includes(reason)) {
      return res_.error(res, `reason must be one of: ${REPORT_REASONS.join(', ')}`, 422);
    }
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) return res_.error(res, 'User not found', 404);

    // One open report per reporter → user (update details instead of spamming)
    const existing = await prisma.userReport.findFirst({
      where: { reporterId: req.user.id, reportedId: userId, status: 'open' },
    });
    const row = existing
      ? await prisma.userReport.update({
          where: { id: existing.id },
          data:  { reason, details: details || existing.details, context: context || existing.context },
        })
      : await prisma.userReport.create({
          data: {
            id: uuid(), reporterId: req.user.id, reportedId: userId,
            reason, details: details || null, context: context || null,
          },
        });

    // Reporting also blocks by default (user can turn it off in the app)
    if (alsoBlock !== false && alsoBlock !== 'false') await _doBlock(req.user.id, userId);

    // Urgent flag: several different people reported this user recently
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const distinct = await prisma.userReport.findMany({
      where:    { reportedId: userId, createdAt: { gte: since } },
      distinct: ['reporterId'],
      select:   { reporterId: true },
    });
    if (distinct.length >= URGENT_REPORTERS) {
      logger.warn(`[SAFETY] User ${userId} reported by ${distinct.length} people in 7 days — review urgently`);
    }

    return res_.created(res, { reportId: row.id, blocked: alsoBlock !== false },
      'Thanks for reporting. Our team will review it within 24 hours.');
  } catch (e) { next(e); }
};

// ── ADMIN ────────────────────────────────────────────────
// GET /admin/reports?status=open|reviewed|actioned|dismissed|all
const adminListReports = async (req, res, next) => {
  try {
    const { status = 'open', page = 1, limit = 50 } = req.query;
    const where = status === 'all' ? {} : { status };
    const userSel = { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true, isBanned: true } };

    const [rows, total] = await Promise.all([
      prisma.userReport.findMany({
        where,
        include: { reporter: userSel, reported: userSel },
        orderBy: { createdAt: 'desc' },
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
      }),
      prisma.userReport.count({ where }),
    ]);

    // How many times each reported user has been reported (for priority)
    const ids = [...new Set(rows.map(r => r.reportedId))];
    const counts = ids.length
      ? await prisma.userReport.groupBy({
          by: ['reportedId'], where: { reportedId: { in: ids } }, _count: { _all: true },
        })
      : [];
    const countMap = Object.fromEntries(counts.map(c => [c.reportedId, c._count._all]));

    return res_.success(res, {
      reports: rows.map(r => ({ ...r, totalReportsAgainst: countMap[r.reportedId] || 1 })),
      total,
    });
  } catch (e) { next(e); }
};

// PATCH /admin/reports/:id { status, adminNote, banUser }
const adminUpdateReport = async (req, res, next) => {
  try {
    const { status, adminNote, banUser } = req.body;
    if (status && !['open', 'reviewed', 'actioned', 'dismissed'].includes(status)) {
      return res_.error(res, 'Invalid status', 422);
    }
    const reportRow = await prisma.userReport.findUnique({ where: { id: req.params.id } });
    if (!reportRow) return res_.error(res, 'Report not found', 404);

    const updated = await prisma.userReport.update({
      where: { id: reportRow.id },
      data: {
        ...(status && { status }),
        ...(adminNote !== undefined && { adminNote }),
        reviewedBy: req.admin?.id || null,
        reviewedAt: new Date(),
      },
    });

    if (banUser === true || banUser === 'true') {
      await prisma.user.update({
        where: { id: reportRow.reportedId },
        data:  { isBanned: true, status: 'BANNED' },
      });
      await prisma.refreshToken.deleteMany({ where: { userId: reportRow.reportedId } }).catch(() => {});
      // Close every open report against this user
      await prisma.userReport.updateMany({
        where: { reportedId: reportRow.reportedId, status: 'open' },
        data:  { status: 'actioned', reviewedBy: req.admin?.id || null, reviewedAt: new Date() },
      });
    }

    return res_.success(res, { report: updated }, banUser ? 'User banned & report actioned' : 'Report updated');
  } catch (e) { next(e); }
};

module.exports = {
  REPORT_REASONS,
  blockedIdsFor,
  isBlockedBetween,
  notBlockedWhere,
  block,
  unblock,
  listBlocked,
  report,
  adminListReports,
  adminUpdateReport,
};
