'use strict';
const prisma = require('../../config/db');
const res_   = require('../../utils/response');

// GET /admin/dashboard/stats
const getStats = async (req, res, next) => {
  try {
    const now      = new Date();
    const today    = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth= new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth= new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      totalUsers, activeUsers, bannedUsers,
      newUsersToday, newUsersMonth, newUsersLastMonth,
      totalSessions, sessionsToday, completedSessions, missedSessions,
      totalMatches, matchesToday,
      totalRevenue, revenueMonth,
      proUsers, eliteUsers,
      totalMessages, messagesToday,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE', isBanned: false } }),
      prisma.user.count({ where: { isBanned: true } }),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { createdAt: { gte: thisMonth } } }),
      prisma.user.count({ where: { createdAt: { gte: lastMonth, lte: lastMonthEnd } } }),
      prisma.workoutSession.count(),
      prisma.workoutSession.count({ where: { createdAt: { gte: today } } }),
      prisma.workoutSession.count({ where: { status: 'completed' } }),
      prisma.workoutSession.count({ where: { status: 'missed' } }),
      prisma.match.count(),
      prisma.match.count({ where: { createdAt: { gte: today } } }),
      prisma.order.aggregate({ where: { status: 'paid' }, _sum: { amount: true } }),
      prisma.order.aggregate({ where: { status: 'paid', createdAt: { gte: thisMonth } }, _sum: { amount: true } }),
      prisma.user.count({ where: { subscriptionPlan: 'pro' } }),
      prisma.user.count({ where: { subscriptionPlan: 'elite' } }),
      prisma.message.count(),
      prisma.message.count({ where: { createdAt: { gte: today } } }),
    ]);

    // 7-day daily signups for chart
    const signupChart = await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const d   = new Date(today); d.setDate(d.getDate() - (6 - i));
        const end = new Date(d);      end.setDate(end.getDate() + 1);
        return prisma.user.count({ where: { createdAt: { gte: d, lt: end } } })
          .then(count => ({ date: d.toISOString().slice(0, 10), count }));
      })
    );

    // 7-day daily revenue for chart (paise → rupees)
    const revenueChart = await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const d   = new Date(today); d.setDate(d.getDate() - (6 - i));
        const end = new Date(d);     end.setDate(end.getDate() + 1);
        return prisma.order.aggregate({
          where: { status: 'paid', createdAt: { gte: d, lt: end } },
          _sum:  { amount: true },
        }).then(r => ({ date: d.toISOString().slice(0, 10), amount: Math.round((r._sum.amount || 0) / 100) }));
      })
    );

    const userGrowth = newUsersLastMonth > 0
      ? (((newUsersMonth - newUsersLastMonth) / newUsersLastMonth) * 100).toFixed(1)
      : null;

    return res_.success(res, {
      users:     { total: totalUsers, active: activeUsers, banned: bannedUsers, newToday: newUsersToday, newMonth: newUsersMonth, growth: userGrowth },
      sessions:  { total: totalSessions, today: sessionsToday, completed: completedSessions, missed: missedSessions, completionRate: totalSessions > 0 ? ((completedSessions / totalSessions) * 100).toFixed(1) : 0 },
      matches:   { total: totalMatches, today: matchesToday },
      revenue:   { totalPaise: totalRevenue._sum.amount || 0, totalRupees: Math.round((totalRevenue._sum.amount || 0) / 100), monthPaise: revenueMonth._sum.amount || 0, monthRupees: Math.round((revenueMonth._sum.amount || 0) / 100) },
      plans:     { pro: proUsers, elite: eliteUsers, free: totalUsers - proUsers - eliteUsers },
      messages:  { total: totalMessages, today: messagesToday },
      charts:    { signups: signupChart, revenue: revenueChart },
    });
  } catch (e) { next(e); }
};

// GET /admin/dashboard/recent-activity
const getRecentActivity = async (req, res, next) => {
  try {
    const [recentUsers, recentOrders, recentSessions, auditLogs] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' }, take: 8,
        select: { id: true, firstName: true, lastName: true, email: true, subscriptionPlan: true, createdAt: true, avatarUrl: true },
      }),
      prisma.order.findMany({
        where: { status: 'paid' }, orderBy: { createdAt: 'desc' }, take: 8,
        include: { user: { select: { firstName: true, lastName: true, email: true } }, plan: { select: { name: true } } },
      }),
      prisma.workoutSession.findMany({
        orderBy: { createdAt: 'desc' }, take: 6,
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' }, take: 10,
        include: { admin: { select: { firstName: true, lastName: true, role: true } } },
      }),
    ]);
    return res_.success(res, { recentUsers, recentOrders, recentSessions, auditLogs });
  } catch (e) { next(e); }
};

module.exports = { getStats, getRecentActivity };
