'use strict';
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const prisma = require('../../config/db');
const res_   = require('../../utils/response');

const issueAdminToken = (admin) =>
  jwt.sign(
    { adminId: admin.id, role: admin.role },
    process.env.ADMIN_JWT_SECRET || process.env.JWT_ACCESS_SECRET,
    { expiresIn: '8h' }
  );

// POST /admin/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const admin = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
    if (!admin || !admin.isActive) return res_.error(res, 'Invalid credentials', 401);

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) return res_.error(res, 'Invalid credentials', 401);

    await prisma.adminUser.update({
      where: { id: admin.id },
      data:  { lastLoginAt: new Date() },
    });

    const token = issueAdminToken(admin);
    return res_.success(res, {
      token,
      admin: {
        id:        admin.id,
        email:     admin.email,
        firstName: admin.firstName,
        lastName:  admin.lastName,
        role:      admin.role,
        avatarUrl: admin.avatarUrl,
      },
    }, 'Login successful');
  } catch (e) { next(e); }
};

// GET /admin/auth/me
const me = async (req, res, next) => {
  try {
    const admin = await prisma.adminUser.findUnique({
      where: { id: req.admin.id },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, avatarUrl: true, lastLoginAt: true, createdAt: true },
    });
    return res_.success(res, admin);
  } catch (e) { next(e); }
};

// POST /admin/auth/change-password
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin.id } });
    const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!valid) return res_.error(res, 'Current password incorrect', 400);

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.adminUser.update({ where: { id: req.admin.id }, data: { passwordHash: hash } });
    return res_.success(res, null, 'Password changed');
  } catch (e) { next(e); }
};

module.exports = { login, me, changePassword };
