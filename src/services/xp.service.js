'use strict';
const prisma    = require('../config/db');
const xpUtils   = require('../utils/xp');
const notifSvc  = require('./notification.service');

const awardXp = async (userId, action) => {
  const amount = xpUtils.xpForAction(action);
  if (!amount) return null;

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      xpTotal: { increment: amount },
      xpEvents: { create: { action, xpAmount: amount } },
    },
    select: { xpTotal: true, level: true },
  });

  const newLevel = xpUtils.levelFromXp(user.xpTotal);
  if (newLevel > user.level) {
    await prisma.user.update({
      where: { id: userId },
      data:  { level: newLevel },
    });
  }

  await notifSvc.notifyXpGained(userId, amount, action);
  return { amount, newTotal: user.xpTotal, newLevel };
};

module.exports = { awardXp };
