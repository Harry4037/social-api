'use strict';
const { hashPassword, verifyPassword } = require('../../utils/password');
const { v4: uuid } = require('uuid');
const prisma = require('../../config/db');
const res_ = require('../../utils/response');
const { formatUser } = require('../../utils/formatUser');

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'ANALYST', 'SUPPORT'];

const userSelect = {
  include: { _count: { select: { matchesA: true, sessionsAsUser: true, orders: true } } },
};

// GET /admin/users
const listUsers = async (req, res, next) => {
  try {
    const { search = '', status, plan, activity } = req.query;
    // Allow-listed sort (ordering by passwordHash etc. leaked hash order;
    // unknown columns caused 500s) and a hard page-size cap
    const SORTABLE = ['createdAt', 'lastActiveAt', 'lastLoginAt', 'xpTotal', 'level', 'trustScore', 'firstName', 'email'];
    if (req.query.sort && !SORTABLE.includes(req.query.sort)) {
      return res_.error(res, `sort must be one of: ${SORTABLE.join(', ')}`, 422);
    }
    const sort  = req.query.sort || 'createdAt';
    const order = req.query.order === 'asc' ? 'asc' : 'desc';
    const { page, limit, skip } = require('../../utils/paging').pageParams(req.query, { def: 20, max: 100 });
    const where = {};

    if (search) {
      where.OR = [
        { email: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { username: { contains: search } },
        { city: { contains: search } },
      ];
    }
    if (status) where.status = status;
    if (plan) where.subscriptionPlan = plan;
    if (activity) where.primaryActivity = activity;

    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, skip, take: limit, orderBy: { [sort]: order }, ...userSelect }),
      prisma.user.count({ where }),
    ]);

    return res_.paginated(res, users.map(formatUser), { page, limit, total });
  } catch (e) { next(e); }
};

const getUserWithStats = async (req, res, next) => {
  try {
    const { id } = req.params;
    const now = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    // Fetch all data in parallel — auto, no manual entry needed
    const [
      user,
      superLikesToday,
      superLikesWeek,
      superLikesTotal,
      boostData,
    ] = await Promise.all([
      // Existing user fetch
      prisma.user.findUnique({
        where: { id },
        select: {
          id: true, firstName: true, lastName: true,
          email: true, avatarUrl: true, city: true,
          primaryActivity: true, subscriptionPlan: true,
          trustScore: true, chatTokens: true,
          idVerified: true, isInfluencer: true,
          status: true, createdAt: true, lastActiveAt: true,
          level: true, xpTotal: true,
        },
      }),

      // ⭐ Super Likes today
      prisma.swipe.count({
        where: {
          swiperId: id,
          action: 'super_like',
          createdAt: { gte: today },
        },
      }),

      // ⭐ Super Likes this week
      prisma.swipe.count({
        where: {
          swiperId: id,
          action: 'super_like',
          createdAt: { gte: weekStart },
        },
      }),

      // ⭐ Super Likes all time
      prisma.swipe.count({
        where: { swiperId: id, action: 'super_like' },
      }),

      // ⚡ Active boost — read boostExpiresAt from User model
      prisma.user.findUnique({ where: { id }, select: { boostExpiresAt: true } }),
    ]);

    // TODO: add BoostHistory model for full stats
    const isBoostActive = boostData?.boostExpiresAt && boostData.boostExpiresAt > now;
    const activeBoost = isBoostActive ? { expiresAt: boostData.boostExpiresAt } : null;
    const boostsWeek = null;
    const boostsTotal = null;
    const lastBoost = null;

    if (!user) return res_.error(res, 'User not found', 404);

    // Plan limits
    const plan = user.subscriptionPlan || 'free';
    const superLikeLimit = plan === 'elite' ? 999 : plan === 'pro' ? 5 : 1;
    const boostLimit = plan === 'elite' ? 3 : plan === 'pro' ? 1 : 0;

    // Boost remaining time
    const boostRemainingMins = activeBoost
      ? Math.max(0, Math.round(
        (new Date(activeBoost.expiresAt) - now) / 60000
      ))
      : 0;

    return res_.success(res, {
      ...user,

      // ⭐ Super Like stats — auto calculated
      superLikes: {
        today: superLikesToday,
        todayLimit: superLikeLimit === 999 ? 'Unlimited' : superLikeLimit,
        thisWeek: superLikesWeek,
        allTime: superLikesTotal,
      },

      // ⚡ Boost stats — auto calculated
      boost: {
        isActive: !!activeBoost,
        expiresAt: activeBoost?.expiresAt || null,
        remainingMins: boostRemainingMins,
        usedThisWeek: boostsWeek,
        weeklyLimit: boostLimit,
        weeklyRemaining: Math.max(0, boostLimit - boostsWeek),
        allTime: boostsTotal,
        lastBoostAt: lastBoost?.createdAt || null,
      },
    });
  } catch (e) { next(e); }
};

const getDashboardStats = async (req, res, next) => {
  try {
    const now = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);

    // Existing stats + new auto stats
    const [
      superLikesToday,
      activeBoostsNow,
      boostsToday,
    ] = await Promise.all([
      prisma.swipe.count({
        where: {
          action: 'super_like',
          createdAt: { gte: today },
        },
      }),
      prisma.user.count({ where: { boostExpiresAt: { gt: now } } }),
      // TODO: add BoostHistory model for full stats
      Promise.resolve(0),
    ]);

    // Add to existing stats return:
    return res_.success(res, {
      // ... existing stats ...
      superLikesToday,   // ⭐ Auto
      activeBoostsNow,   // ⚡ Live count
      boostsToday,       // ⚡ Today total
    });
  } catch (e) { next(e); }
};

// GET /admin/users/:id
const getUser = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { matchesA: true, sessionsAsUser: true, orders: true, messagesSent: true } },
        orders: { orderBy: { createdAt: 'desc' }, take: 5, include: { plan: true } },
        sessionsAsUser: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!user) return res_.error(res, 'User not found', 404);
    return res_.success(res, { ...formatUser(user), orders: user.orders, recentSessions: user.sessionsAsUser });
  } catch (e) { next(e); }
};

// PATCH /admin/users/:id  (edit any field)
const updateUser = async (req, res, next) => {
  try {
    const allowed = ['firstName', 'lastName', 'email', 'phone', 'city', 'country', 'bio',
      'primaryActivity', 'experienceLevel', 'xpTotal', 'level', 'chatTokens',
      'trustScore', 'idVerified', 'isInfluencer', 'subscriptionPlan', 'subscriptionExpiry'];
    const data = {};
    for (const k of allowed) { if (req.body[k] !== undefined) data[k] = req.body[k]; }
    // Basic sanity: a bad email could be used to take the account over via
    // forgot-password; numbers must stay in sane ranges
    if (data.email !== undefined) {
      const e = String(data.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 191) return res_.error(res, 'Invalid email', 422);
      data.email = e;
    }
    const bounds = { chatTokens: [0, 1000], xpTotal: [0, 10000000], level: [1, 100], trustScore: [0, 100] };
    for (const [k, [lo, hi]] of Object.entries(bounds)) {
      if (data[k] === undefined) continue;
      const n = Number(data[k]);
      if (!Number.isFinite(n) || n < lo || n > hi) return res_.error(res, `${k} must be between ${lo} and ${hi}`, 422);
      data[k] = n;
    }

    const user = await prisma.user.update({ where: { id: req.params.id }, data, ...userSelect });
    return res_.success(res, formatUser(user), 'User updated');
  } catch (e) { next(e); }
};

// POST /admin/users/:id/ban
const banUser = async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data: { isBanned: true, status: 'BANNED' },
    });
    // Invalidate all sessions + drop live sockets (chat kept working before)
    await prisma.refreshToken.deleteMany({ where: { userId: req.params.id } });
    require('../../sockets/socket').disconnectUser(req.app.get('io'), req.params.id);
    return res_.success(res, null, 'User banned');
  } catch (e) { next(e); }
};

// POST /admin/users/:id/unban
const unbanUser = async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.params.id }, select: { deletedAt: true } });
    if (!u) return res_.error(res, 'User not found', 404);
    // A deleted account stays deleted (unban used to bring it back)
    if (u.deletedAt) return res_.error(res, 'This account was deleted and cannot be restored', 409);
    await prisma.user.update({
      where: { id: req.params.id },
      data: { isBanned: false, status: 'ACTIVE' },
    });
    return res_.success(res, null, 'User unbanned');
  } catch (e) { next(e); }
};

// DELETE /admin/users/:id  (soft delete)
const deleteUser = async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date(), status: 'INACTIVE', isBanned: true },
    });
    await prisma.refreshToken.deleteMany({ where: { userId: req.params.id } });
    return res_.success(res, null, 'User deleted');
  } catch (e) { next(e); }
};

// POST /admin/users/:id/grant-tokens
const grantTokens = async (req, res, next) => {
  try {
    const { amount = 10 } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { chatTokens: { increment: Number(amount) } },
      select: { id: true, chatTokens: true },
    });
    return res_.success(res, user, `Granted ${amount} tokens`);
  } catch (e) { next(e); }
};

// ── Admin user management (who can log into this panel) ──
// GET /admin/admins
const listAdmins = async (req, res, next) => {
  try {
    const admins = await prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    });
    return res_.success(res, admins);
  } catch (e) { next(e); }
};

// POST /admin/admins
const createAdmin = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;
    if (role !== undefined && !ADMIN_ROLES.includes(role)) {
      return res_.error(res, `role must be one of: ${ADMIN_ROLES.join(', ')}`, 422);
    }
    const existing = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res_.error(res, 'Email already registered', 409);

    const hash = await hashPassword(password);
    const admin = await prisma.adminUser.create({
      data: { id: uuid(), email: email.toLowerCase(), passwordHash: hash, firstName, lastName, role: role || 'SUPPORT' },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, createdAt: true },
    });
    return res_.created(res, admin, 'Admin created');
  } catch (e) { next(e); }
};

// PATCH /admin/admins/:id
const updateAdmin = async (req, res, next) => {
  try {
    const { firstName, lastName, role, isActive } = req.body;
    if (role !== undefined && !ADMIN_ROLES.includes(role)) {
      return res_.error(res, `role must be one of: ${ADMIN_ROLES.join(', ')}`, 422);
    }
    // Never leave the panel without an active SUPER_ADMIN
    const target = await prisma.adminUser.findUnique({ where: { id: req.params.id }, select: { role: true, isActive: true } });
    if (!target) return res_.error(res, 'Admin not found', 404);
    const losesSuper = target.role === 'SUPER_ADMIN' &&
      ((isActive !== undefined && !isActive) || (role !== undefined && role !== 'SUPER_ADMIN'));
    if (losesSuper) {
      const others = await prisma.adminUser.count({
        where: { role: 'SUPER_ADMIN', isActive: true, id: { not: req.params.id } },
      });
      if (others === 0) return res_.error(res, 'At least one active SUPER_ADMIN is required', 409);
    }
    const admin = await prisma.adminUser.update({
      where: { id: req.params.id },
      data: { ...(firstName !== undefined && { firstName }), ...(lastName !== undefined && { lastName }), ...(role !== undefined && { role }), ...(isActive !== undefined && { isActive }) },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });
    return res_.success(res, admin, 'Admin updated');
  } catch (e) { next(e); }
};

module.exports = { getDashboardStats, listUsers, getUser, updateUser, banUser, unbanUser, deleteUser, grantTokens, listAdmins, createAdmin, updateAdmin, getUserWithStats };
