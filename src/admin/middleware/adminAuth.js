'use strict';
const jwt    = require('jsonwebtoken');
const prisma = require('../../config/db');
const { error } = require('../../utils/response');

const ROLE_RANK = { SUPER_ADMIN: 5, ADMIN: 4, MODERATOR: 3, ANALYST: 2, SUPPORT: 1 };

/** Authenticate admin JWT (separate secret from user JWT) */
const adminAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return error(res, 'No token provided', 401);

    const token   = header.slice(7);
    const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET || process.env.JWT_ACCESS_SECRET);
    if (!payload.adminId) return error(res, 'Invalid admin token', 401);

    const admin = await prisma.adminUser.findUnique({
      where: { id: payload.adminId },
      select: { id: true, email: true, role: true, firstName: true, lastName: true, isActive: true },
    });
    if (!admin || !admin.isActive) return error(res, 'Admin account not accessible', 403);

    req.admin = admin;
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') return error(res, 'Token expired', 401);
    return error(res, 'Authentication error', 401);
  }
};

/** Require minimum role level */
const requireRole = (...roles) => (req, res, next) => {
  const myRank  = ROLE_RANK[req.admin?.role] ?? 0;
  const needed  = Math.max(...roles.map(r => ROLE_RANK[r] ?? 0));
  if (myRank < needed) return error(res, 'Insufficient permissions', 403);
  next();
};

/** Log admin action to audit_logs table */
const audit = (action, entityType) => async (req, res, next) => {
  res.on('finish', async () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        await prisma.auditLog.create({
          data: {
            adminId:    req.admin.id,
            action,
            entityType,
            entityId:   req.params.id || req.params.userId || null,
            details:    { body: req.body, query: req.query },
            ip:         req.ip,
          },
        });
      } catch (_) {}
    }
  });
  next();
};

module.exports = { adminAuth, requireRole, audit };
