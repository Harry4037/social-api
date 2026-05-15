'use strict';
const { v4: uuid } = require('uuid');
const prisma = require('../../config/db');
const res_   = require('../../utils/response');

// ── Sessions ──────────────────────────────────────────────

// GET /admin/sessions
const listSessions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, activity, search } = req.query;
    const skip  = (Number(page) - 1) * Number(limit);
    const where = {};
    if (status)   where.status   = status;
    if (activity) where.activity = activity;
    if (search) {
      where.OR = [
        { user:  { OR: [{ firstName: { contains: search } }, { lastName: { contains: search } }, { email: { contains: search } }] } },
        { gymName: { contains: search } },
      ];
    }
    const [sessions, total] = await Promise.all([
      prisma.workoutSession.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          user:  { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          buddy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
      }),
      prisma.workoutSession.count({ where }),
    ]);
    return res_.paginated(res, sessions, { page, limit, total });
  } catch (e) { next(e); }
};

// PATCH /admin/sessions/:id
const updateSession = async (req, res, next) => {
  try {
    const { status, xpEarned, notes } = req.body;
    const session = await prisma.workoutSession.update({
      where: { id: req.params.id },
      data: {
        ...(status    !== undefined && { status }),
        ...(xpEarned  !== undefined && { xpEarned }),
        ...(notes     !== undefined && { notes }),
      },
    });
    return res_.success(res, session, 'Session updated');
  } catch (e) { next(e); }
};

// ── Matches ───────────────────────────────────────────────

// GET /admin/matches
const listMatches = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const skip  = (Number(page) - 1) * Number(limit);
    const where = {};
    if (search) {
      where.OR = [
        { userA: { OR: [{ firstName: { contains: search } }, { email: { contains: search } }] } },
        { userB: { OR: [{ firstName: { contains: search } }, { email: { contains: search } }] } },
      ];
    }
    const [matches, total] = await Promise.all([
      prisma.match.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          userA: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          userB: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          chat:  { select: { id: true, _count: { select: { messages: true } } } },
        },
      }),
      prisma.match.count({ where }),
    ]);
    return res_.paginated(res, matches, { page, limit, total });
  } catch (e) { next(e); }
};

// DELETE /admin/matches/:id
const deleteMatch = async (req, res, next) => {
  try {
    await prisma.match.delete({ where: { id: req.params.id } });
    return res_.success(res, null, 'Match removed');
  } catch (e) { next(e); }
};

// ── Orders / Revenue ──────────────────────────────────────

// GET /admin/orders
const listOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, type, search } = req.query;
    const skip  = (Number(page) - 1) * Number(limit);
    const where = {};
    if (status) where.status = status;
    if (type)   where.type   = type;
    if (search) {
      where.user = { OR: [{ email: { contains: search } }, { firstName: { contains: search } }] };
    }
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
          plan: { select: { name: true, slug: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);
    return res_.paginated(res, orders, { page, limit, total });
  } catch (e) { next(e); }
};

// ── Subscription Plans ────────────────────────────────────

// GET /admin/plans
const listPlans = async (req, res, next) => {
  try {
    const plans = await prisma.subscriptionPlanConfig.findMany({
      orderBy: { price: 'asc' },
      include: { _count: { select: { orders: true } } },
    });
    const formatted = plans.map(p => ({
      ...p,
      features: typeof p.features === 'string' ? JSON.parse(p.features) : p.features,
    }));
    return res_.success(res, formatted);
  } catch (e) { next(e); }
};

// PATCH /admin/plans/:id
const updatePlan = async (req, res, next) => {
  try {
    const { name, description, price, features, isPopular, isActive } = req.body;
    const plan = await prisma.subscriptionPlanConfig.update({
      where: { id: req.params.id },
      data: {
        ...(name        !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(price       !== undefined && { price: Number(price) }),
        ...(features    !== undefined && { features: Array.isArray(features) ? JSON.stringify(features) : features }),
        ...(isPopular   !== undefined && { isPopular }),
        ...(isActive    !== undefined && { isActive }),
      },
    });
    return res_.success(res, plan, 'Plan updated');
  } catch (e) { next(e); }
};

// ── Broadcast Notification ────────────────────────────────

// POST /admin/notifications/broadcast
const broadcastNotification = async (req, res, next) => {
  try {
    const { title, message, type = 'system', targetPlan, targetActivity } = req.body;

    const where = {};
    if (targetPlan)     where.subscriptionPlan = targetPlan;
    if (targetActivity) where.primaryActivity  = targetActivity;

    const users = await prisma.user.findMany({
      where: { ...where, isBanned: false, status: 'ACTIVE' },
      select: { id: true },
    });

    await prisma.notification.createMany({
      data: users.map(u => ({
        id: uuid(), userId: u.id, type, title, message,
      })),
      skipDuplicates: true,
    });

    return res_.success(res, { sent: users.length }, `Broadcast sent to ${users.length} users`);
  } catch (e) { next(e); }
};

// ── Audit Logs ────────────────────────────────────────────

// GET /admin/audit-logs
const listAuditLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 30, adminId } = req.query;
    const skip  = (Number(page) - 1) * Number(limit);
    const where = adminId ? { adminId } : {};
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: { admin: { select: { firstName: true, lastName: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return res_.paginated(res, logs, { page, limit, total });
  } catch (e) { next(e); }
};

module.exports = {
  listSessions, updateSession,
  listMatches, deleteMatch,
  listOrders,
  listPlans, updatePlan,
  broadcastNotification,
  listAuditLogs,
};
