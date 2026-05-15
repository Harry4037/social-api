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
