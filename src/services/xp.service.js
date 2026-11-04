'use strict';
const xpUtils   = require('../utils/xp');
const notifSvc  = require('./notification.service');

// Fixed-amount awards (match, streak milestones …) go through the one XP
// path: weekly / monthly leaderboards, one level table, level-up push.
const awardXp = async (userId, action) => {
  const amount = xpUtils.xpForAction(action);
  if (!amount) return null;
  const r = await require('../controllers/xp.controller').awardXP(userId, amount, action);
  if (r) await notifSvc.notifyXpGained(userId, amount, action);
  return r && { amount, newTotal: r.newXpTotal, newLevel: r.newLevel.level };
};

module.exports = { awardXp };
