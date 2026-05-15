'use strict';
const prisma  = require('../config/db');
const logger  = require('../config/logger');

const create = async ({
  userId, type, title, message, actionUrl = null, data = null,
}) => {
  try {
    return await prisma.notification.create({
      data: { userId, type, title, message, actionUrl, data },
    });
  } catch (e) {
    logger.error('notification.create failed: ' + e.message);
    return null;
  }
};

const notifyMatch = (userAId, userBId, matchId) =>
  Promise.all([
    create({ userId: userAId, type: 'match', title: "It's a Match! 🤝",
      message: "You matched with a new gym buddy! Say hi.",
      actionUrl: `/match/${matchId}` }),
    create({ userId: userBId, type: 'match', title: "It's a Match! 🤝",
      message: "You matched with a new gym buddy! Say hi.",
      actionUrl: `/match/${matchId}` }),
  ]);

const notifySessionScheduled = (buddyId, userName, sessionId) =>
  create({ userId: buddyId, type: 'session',
    title: `New Session Scheduled 📅`,
    message: `${userName} scheduled a workout session with you!`,
    actionUrl: `/sessions/${sessionId}`,
    data: { sessionId },
  });

const notifyProofRequired = (userId, sessionId) =>
  create({ userId, type: 'proof',
    title: 'Upload Workout Proof ⚠️',
    message: 'Your session just ended! Upload proof within 8 hours to keep your tokens.',
    actionUrl: `/sessions/${sessionId}/proof`,
    data: { sessionId },
  });

const notifyXpGained = (userId, xpAmount, action) =>
  create({ userId, type: 'xp',
    title: `+${xpAmount} XP Earned ⭐`,
    message: `You earned ${xpAmount} XP for: ${action.replace(/_/g, ' ')}.`,
  });

const notifyTokenLow = (userId, remaining) =>
  create({ userId, type: 'token',
    title: '🎫 Low on Chat Tokens',
    message: `Only ${remaining} token${remaining === 1 ? '' : 's'} remaining. Buy more to keep chatting.`,
    actionUrl: '/subscription',
  });

module.exports = {
  create,
  notifyMatch,
  notifySessionScheduled,
  notifyProofRequired,
  notifyXpGained,
  notifyTokenLow,
};
