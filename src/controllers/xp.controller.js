// ─────────────────────────────────────────────────────────
//  xp.controller.js
//  Centralized XP + Level + Trust + Token logic
//  Called by session, challenge, strike controllers
// ─────────────────────────────────────────────────────────
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── LEVEL THRESHOLDS ──────────────────────────────────────
const LEVELS = [
  { level: 1,  name: 'Rookie',    xp: 0      },
  { level: 2,  name: 'Grinder',   xp: 500    },
  { level: 3,  name: 'Regular',   xp: 1500   },
  { level: 4,  name: 'Dedicated', xp: 3500   },
  { level: 5,  name: 'Warrior',   xp: 7000   },
  { level: 6,  name: 'Champion',  xp: 13000  },
  { level: 7,  name: 'Elite',     xp: 22000  },
  { level: 8,  name: 'Legend',    xp: 35000  },
  { level: 9,  name: 'Icon',      xp: 55000  },
  { level: 10, name: 'GOATified', xp: 80000  },
];

// ── TRUST FLOORS (inactivity only) ───────────────────────
const TRUST_FLOORS = [
  { min: 0,  max: 25,  floor: 0  }, // New
  { min: 26, max: 50,  floor: 20 }, // Regular
  { min: 51, max: 75,  floor: 35 }, // Trusted
  { min: 76, max: 90,  floor: 50 }, // Elite
  { min: 91, max: 100, floor: 65 }, // Legend
];

// ── TRUST LEVEL NAMES ─────────────────────────────────────
const TRUST_LEVELS = [
  { min: 0,  max: 25,  name: 'New'     },
  { min: 26, max: 50,  name: 'Regular' },
  { min: 51, max: 75,  name: 'Trusted' },
  { min: 76, max: 90,  name: 'Elite'   },
  { min: 91, max: 100, name: 'Legend'  },
];

// ── HELPERS ───────────────────────────────────────────────
const getLevel = (xpTotal) => {
  let current = LEVELS[0];
  for (const l of LEVELS) {
    if (xpTotal >= l.xp) current = l;
    else break;
  }
  return current;
};

const getTrustLevel = (score) => {
  const s = Number(score);
  return TRUST_LEVELS.find(t => s >= t.min && s <= t.max) || TRUST_LEVELS[0];
};

const getTrustFloor = (score) => {
  const s = Number(score);
  const tier = TRUST_FLOORS.find(t => s >= t.min && s <= t.max) || TRUST_FLOORS[0];
  return tier.floor;
};

// ── AWARD XP ─────────────────────────────────────────────
// action examples: 'session_complete', 'challenge_station', 'profile_complete'
const awardXP = async (userId, amount, action, metadata = {}) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const newXpTotal   = user.xpTotal   + amount;
  const newWeeklyXp  = user.weeklyXp  + amount;
  const newMonthlyXp = user.monthlyXp + amount;
  const newLevel     = getLevel(newXpTotal);
  const leveledUp    = newLevel.level > user.level;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        xpTotal:   newXpTotal,
        weeklyXp:  newWeeklyXp,
        monthlyXp: newMonthlyXp,
        level:     newLevel.level,
      },
    }),
    prisma.xpEvent.create({
      data: {
        id:       require('crypto').randomUUID(),
        userId,
        action,
        xpAmount: amount,
        metadata,
      },
    }),
  ]);

  // Send level-up notification if leveled up
  if (leveledUp) {
    await _createNotification(userId,
      `🎉 Level ${newLevel.level} unlocked — ${newLevel.name}!`,
      'level_up',
      { level: newLevel.level, name: newLevel.name }
    );
  }

  return { xpAwarded: amount, newXpTotal, newLevel, leveledUp };
};

// ── SESSION XP CALCULATION ────────────────────────────────
const calcSessionXP = (session, participantCount = 2) => {
  let xp = 100; // base for 1hr buddy

  // Group bonus
  if (participantCount >= 6) xp = 150;
  else if (participantCount >= 3) xp = 120;

  // Duration modifier
  const dur = session.durationMins || 60;
  if (dur === 45)  xp -= 10;
  if (dur === 90)  xp += 20;
  if (dur === 120) xp += 40;

  return xp;
};

// ── UPDATE TRUST SCORE ────────────────────────────────────
const updateTrust = async (userId, delta, reason) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  let newScore = Number(user.trustScore) + delta;

  // Apply floor ONLY for negative inactivity changes
  // Missed sessions can go below floor
  const isInactivity = reason === 'inactivity_decay';
  if (isInactivity && delta < 0) {
    const floor = getTrustFloor(user.trustScore);
    newScore = Math.max(newScore, floor);
  }

  // Hard clamp 0–100
  newScore = Math.min(100, Math.max(0, newScore));
  newScore = Math.round(newScore * 100) / 100; // 2 decimal places

  const oldLevel   = getTrustLevel(user.trustScore);
  const newLevel   = getTrustLevel(newScore);
  const leveledUp  = newLevel.name !== oldLevel.name && delta > 0;

  await prisma.user.update({
    where: { id: userId },
    data:  { trustScore: newScore },
  });

  // Trust level up notification
  if (leveledUp) {
    await _createNotification(userId,
      `🛡️ You're now ${newLevel.name}! Trust Score ${Math.floor(newScore)}+`,
      'trust_level_up',
      { level: newLevel.name, score: newScore }
    );
  }

  return { newScore, oldLevel: oldLevel.name, newLevel: newLevel.name, leveledUp };
};

// ── AWARD TOKEN ───────────────────────────────────────────
const awardToken = async (userId, amount, reason) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  // Cap based on plan
  const cap = user.subscriptionPlan === 'pro' ? 200 : 50;
  const current = user.chatTokens;
  const toAdd = Math.min(amount, cap - current);
  if (toAdd <= 0) return { awarded: 0, newBalance: current, reason: 'cap_reached' };

  await prisma.user.update({
    where: { id: userId },
    data:  { chatTokens: { increment: toAdd } },
  });

  return { awarded: toAdd, newBalance: current + toAdd };
};

// ── DEDUCT TOKEN ──────────────────────────────────────────
const deductToken = async (userId, amount, reason) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const newBalance = Math.max(0, user.chatTokens - amount);
  await prisma.user.update({
    where: { id: userId },
    data:  { chatTokens: newBalance },
  });

  // Low token notification (≤3)
  if (newBalance <= 3) {
    await _createNotification(userId,
      `🎟️ Only ${newBalance} token${newBalance === 1 ? '' : 's'} left. Top up?`,
      'token_low',
      { balance: newBalance }
    );
  }

  return { deducted: amount, newBalance };
};

// ── SESSION COMPLETE HANDLER ──────────────────────────────
// Called after proof confirmed. Awards XP + Trust + Token to both users.
const onSessionComplete = async (session, participantCount = 2) => {
  const results = {};
  const sessionXP = calcSessionXP(session, participantCount);
  const buddyIds = [session.userId, session.buddyId].filter(Boolean);

  for (const uid of buddyIds) {
    const xpResult    = await awardXP(uid, sessionXP, 'session_complete', { sessionId: session.id });
    const confirmXP   = await awardXP(uid, 20, 'session_confirm_bonus', { sessionId: session.id });
    const trustResult = await updateTrust(uid, 2.0, 'session_complete');
    const tokenResult = await awardToken(uid, 1, 'session_complete');

    results[uid] = {
      xpAwarded:    sessionXP + 20,
      trustGained:  2.0,
      tokenAwarded: tokenResult?.awarded || 0,
      newLevel:     xpResult?.newLevel,
      leveledUp:    xpResult?.leveledUp,
    };
  }

  // Update session record
  await prisma.workoutSession.update({
    where: { id: session.id },
    data:  { xpEarned: sessionXP + 20 },
  });

  return results;
};

// ── SESSION MISSED HANDLER ────────────────────────────────
// Called by CRON when proof window expires.
const onSessionMissed = async (session) => {
  const results = {};
  const userId = session.userId;

  const trustResult = await updateTrust(userId, -5.0, 'session_missed');
  const tokenResult = await deductToken(userId, 1, 'session_missed');

  // Notification
  await _createNotification(userId,
    `😔 You missed your session. Trust -5, Token -1`,
    'session_missed',
    { sessionId: session.id }
  );

  // Update session record
  await prisma.workoutSession.update({
    where: { id: session.id },
    data: {
      status:          'missed',
      tokensDeducted:  1,
      incompleteReason: 'Proof not uploaded within 3 hours of session end',
    },
  });

  results[userId] = {
    trustLost:    5.0,
    tokenDeducted: tokenResult?.deducted || 0,
    newTrust:     trustResult?.newScore,
  };

  return results;
};

// ── TRUST DECAY (called by CRON daily) ───────────────────
const runTrustDecay = async () => {
  const now = new Date();
  const users = await prisma.user.findMany({
    where: { lastActiveAt: { not: null } },
    select: { id: true, lastActiveAt: true, trustScore: true },
  });

  let decayed = 0;
  for (const user of users) {
    const daysSince = Math.floor(
      (now - new Date(user.lastActiveAt)) / (1000 * 60 * 60 * 24)
    );

    let decay = 0;
    if (daysSince >= 30) decay = -3.0;
    else if (daysSince >= 15) decay = -2.0;
    else if (daysSince >= 8)  decay = -1.0;

    if (decay < 0) {
      await updateTrust(user.id, decay, 'inactivity_decay');
      decayed++;
    }
  }

  return { processed: users.length, decayed };
};

// ── WEEKLY XP RESET (called by CRON Saturday 11:59 PM) ──
const resetWeeklyXP = async () => {
  const result = await prisma.user.updateMany({ data: { weeklyXp: 0 } });
  return { reset: result.count };
};

// ── MONTHLY XP RESET ─────────────────────────────────────
const resetMonthlyXP = async () => {
  const result = await prisma.user.updateMany({ data: { monthlyXp: 0 } });
  return { reset: result.count };
};

// ── PRO TOKEN REFILL (called by CRON monthly) ────────────
const refillProTokens = async () => {
  const proUsers = await prisma.user.findMany({
    where: { subscriptionPlan: 'pro' },
    select: { id: true, chatTokens: true },
  });

  let refilled = 0;
  for (const user of proUsers) {
    const toAdd = Math.min(50, 200 - user.chatTokens);
    if (toAdd > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data:  { chatTokens: { increment: toAdd } },
      });
      refilled++;
    }
  }

  return { processed: proUsers.length, refilled };
};

// ── INTERNAL: create notification ────────────────────────
const _createNotification = async (userId, message, type, data = {}) => {
  try {
    await prisma.notification.create({
      data: {
        id:      require('crypto').randomUUID(),
        userId,
        type,
        title:   message,
        body:    message,
        data:    JSON.stringify(data),
        isRead:  false,
      },
    });
  } catch (_) {
    // Notification failure should not break main flow
  }
};

module.exports = {
  awardXP,
  calcSessionXP,
  updateTrust,
  awardToken,
  deductToken,
  onSessionComplete,
  onSessionMissed,
  runTrustDecay,
  resetWeeklyXP,
  resetMonthlyXP,
  refillProTokens,
  getLevel,
  getTrustLevel,
  LEVELS,
  TRUST_LEVELS,
};
