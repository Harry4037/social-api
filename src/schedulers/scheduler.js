'use strict';
const cron    = require('node-cron');
const prisma  = require('../config/db');
const notifSvc= require('../services/notification.service');
const logger  = require('../config/logger');

const TOKEN_DEDUCT_MISSED = 2;

/**
 * Every 5 minutes: mark sessions as 'missed' if the deadline
 * has passed without proof upload, and deduct tokens.
 */
const markMissedSessions = cron.schedule('*/5 * * * *', async () => {
  try {
    const deadline = new Date(Date.now() - 8 * 60 * 60 * 1000); // 8 hours ago

    const overdue = await prisma.workoutSession.findMany({
      where: {
        status:        'scheduled',
        scheduledAt:   { lte: deadline },
        proofImageUrl: null,
      },
      select: { id: true, userId: true, buddyId: true },
    });

    if (!overdue.length) return;
    logger.info(`Marking ${overdue.length} sessions as missed`);

    for (const s of overdue) {
      await prisma.$transaction([
        prisma.workoutSession.update({
          where: { id: s.id },
          data:  { status: 'missed', tokensDeducted: TOKEN_DEDUCT_MISSED },
        }),
        prisma.user.update({
          where: { id: s.userId },
          data:  {
            chatTokens: { decrement: TOKEN_DEDUCT_MISSED },
          },
        }),
      ]);

      await notifSvc.create({
        userId:  s.userId,
        type:    'session',
        title:   '😔 Session Missed',
        message: `You missed a session and ${TOKEN_DEDUCT_MISSED} chat tokens were deducted.`,
        data:    { sessionId: s.id },
      });
    }
  } catch (e) {
    logger.error('markMissedSessions cron error: ' + e.message);
  }
}, { scheduled: false });

/**
 * Every 30 minutes: send proof reminders for sessions that ended
 * within the last 8 hours but haven't been proven yet.
 */
const proofReminders = cron.schedule('*/30 * * * *', async () => {
  try {
    const now         = new Date();
    const eightHrsAgo = new Date(now.getTime() - 8 * 60 * 60 * 1000);

    const sessions = await prisma.workoutSession.findMany({
      where: {
        status:        'scheduled',
        scheduledAt:   { gte: eightHrsAgo, lte: now },
        proofImageUrl: null,
      },
      select: { id: true, userId: true },
    });

    for (const s of sessions) {
      await notifSvc.notifyProofRequired(s.userId, s.id);
    }
    if (sessions.length) logger.info(`Sent ${sessions.length} proof reminders`);
  } catch (e) {
    logger.error('proofReminders cron error: ' + e.message);
  }
}, { scheduled: false });

const startJobs = () => {
  markMissedSessions.start();
  proofReminders.start();
  logger.info('Background jobs started');
};

const stopJobs = () => {
  markMissedSessions.stop();
  proofReminders.stop();
};

module.exports = { startJobs, stopJobs };


// ─────────────────────────────────────────────────────────
//  STREAK CALCULATION — runs daily at midnight
//  Awards XP for 7-day and 30-day streaks
// ─────────────────────────────────────────────────────────
const calculateStreaks = async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      where:  { isActive: true },
      select: { id: true, currentStreak: true, longestStreak: true },
    });

    for (const user of users) {
      // Count consecutive days with at least one completed session
      const sessions = await prisma.session.findMany({
        where:  { participants: { some: { userId: user.id } }, status: 'COMPLETED' },
        select: { scheduledAt: true },
        orderBy:{ scheduledAt: 'desc' },
      });

      let streak = 0;
      const today = new Date(); today.setHours(0,0,0,0);
      let checkDay = new Date(today);

      for (let i = 0; i < 365; i++) {
        const dayStr = checkDay.toDateString();
        const hasSession = sessions.some(s => new Date(s.scheduledAt).toDateString() === dayStr);
        if (!hasSession) break;
        streak++;
        checkDay.setDate(checkDay.getDate() - 1);
      }

      const prevStreak = user.currentStreak;
      const newLongest = Math.max(streak, user.longestStreak || 0);

      await prisma.user.update({
        where: { id: user.id },
        data:  { currentStreak: streak, longestStreak: newLongest },
      });

      // Award streak XP milestones
      if (streak === 7  && prevStreak < 7)  await prisma.user.update({ where:{ id:user.id }, data:{ xpPoints:{ increment:100 } } });
      if (streak === 30 && prevStreak < 30) await prisma.user.update({ where:{ id:user.id }, data:{ xpPoints:{ increment:500 } } });
      if (streak === 100&& prevStreak < 100)await prisma.user.update({ where:{ id:user.id }, data:{ xpPoints:{ increment:1000} } });
    }
    console.log(`[Streak] Calculated streaks for ${users.length} users`);
    await prisma.$disconnect();
  } catch (err) {
    console.error('[Streak] Error:', err);
  }
};

// Schedule streak calculation daily at midnight
cron.schedule('0 0 * * *', calculateStreaks, { timezone: 'Asia/Kolkata' });

// ─────────────────────────────────────────────────────────
//  SKIP PASS RESET — resets 1 free skip per calendar month
// ─────────────────────────────────────────────────────────
const resetSkipPasses = async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const updated = await prisma.user.updateMany({
      where: { freeSkipsUsedThisMonth: { gt: 0 } },
      data:  { freeSkipsUsedThisMonth: 0 },
    });
    console.log(`[SkipPass] Reset skip passes for ${updated.count} users`);
    await prisma.$disconnect();
  } catch (err) {
    console.error('[SkipPass] Error:', err);
  }
};

// First day of every month at 00:01 IST
cron.schedule('1 0 1 * *', resetSkipPasses, { timezone: 'Asia/Kolkata' });
