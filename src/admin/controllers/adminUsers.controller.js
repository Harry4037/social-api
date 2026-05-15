'use strict';
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const prisma = require('../../config/db');
const res_   = require('../../utils/response');
const { formatUser } = require('../../utils/formatUser');

const userSelect = {
  include: { _count: { select: { matchesA: true, sessionsAsUser: true, orders: true } } },
};

// GET /admin/users
const listUsers = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 20, search = '', status, plan,
      activity, sort = 'createdAt', order = 'desc',
    } = req.query;

    const skip  = (Number(page) - 1) * Number(limit);
    const where = {};

    if (search) {
      where.OR = [
        { email:     { contains: search } },
        { firstName: { contains: search } },
        { lastName:  { contains: search } },
        { username:  { contains: search } },
        { city:      { contains: search } },
      ];
    }
    if (status)   where.status            = status;
    if (plan)     where.subscriptionPlan  = plan;
    if (activity) where.primaryActivity   = activity;

    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, skip, take: Number(limit), orderBy: { [sort]: order }, ...userSelect }),
      prisma.user.count({ where }),
    ]);

    return res_.paginated(res, users.map(formatUser), { page, limit, total });
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
    const allowed = ['firstName','lastName','email','phone','city','country','bio',
                     'primaryActivity','experienceLevel','xpTotal','level','chatTokens',
                     'trustScore','idVerified','isInfluencer','subscriptionPlan','subscriptionExpiry'];
    const data = {};
    for (const k of allowed) { if (req.body[k] !== undefined) data[k] = req.body[k]; }

    const user = await prisma.user.update({ where: { id: req.params.id }, data, ...userSelect });
    return res_.success(res, formatUser(user), 'User updated');
  } catch (e) { next(e); }
};

// POST /admin/users/:id/ban
const banUser = async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data:  { isBanned: true, status: 'BANNED' },
    });
    // Invalidate all sessions
    await prisma.refreshToken.deleteMany({ where: { userId: req.params.id } });
    return res_.success(res, null, 'User banned');
  } catch (e) { next(e); }
};

// POST /admin/users/:id/unban
const unbanUser = async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data:  { isBanned: false, status: 'ACTIVE' },
    });
    return res_.success(res, null, 'User unbanned');
  } catch (e) { next(e); }
};

// DELETE /admin/users/:id  (soft delete)
const deleteUser = async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data:  { deletedAt: new Date(), status: 'INACTIVE', isBanned: true },
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
      data:  { chatTokens: { increment: Number(amount) } },
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
    const existing = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res_.error(res, 'Email already registered', 409);

    const hash  = await bcrypt.hash(password, 12);
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
    const admin = await prisma.adminUser.update({
      where: { id: req.params.id },
      data:  { ...(firstName !== undefined && { firstName }), ...(lastName !== undefined && { lastName }), ...(role !== undefined && { role }), ...(isActive !== undefined && { isActive }) },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });
    return res_.success(res, admin, 'Admin updated');
  } catch (e) { next(e); }
};

module.exports = { listUsers, getUser, updateUser, banUser, unbanUser, deleteUser, grantTokens, listAdmins, createAdmin, updateAdmin };
