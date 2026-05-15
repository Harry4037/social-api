'use strict';
const prisma = require('../config/db');
const res_   = require('../utils/response');

// GET /notifications
const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where:   { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.notification.count({ where: { userId: req.user.id } }),
    ]);

    return res_.paginated(res, notifications, { page, limit, total });
  } catch (e) { next(e); }
};

// PATCH /notifications/:id/read
const markRead = async (req, res, next) => {
  try {
    const notif = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!notif) return res_.error(res, 'Notification not found', 404);

    await prisma.notification.update({
      where: { id: notif.id },
      data:  { isRead: true, readAt: new Date() },
    });

    return res_.success(res, null, 'Marked as read');
  } catch (e) { next(e); }
};

// PATCH /notifications/read-all
const markAllRead = async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data:  { isRead: true, readAt: new Date() },
    });
    return res_.success(res, null, 'All notifications marked as read');
  } catch (e) { next(e); }
};

module.exports = { getNotifications, markRead, markAllRead };
