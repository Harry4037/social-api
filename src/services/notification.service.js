'use strict';
const prisma  = require('../config/db');
const logger  = require('../config/logger');

// Lazy require — keeps this module loadable even if firebase-admin is absent
let _push = null;
const push = () => {
  if (_push === null) {
    try { _push = require('./pushnotification.service'); }
    catch (e) { _push = false; logger.warn('push service unavailable: ' + e.message); }
  }
  return _push || null;
};

// ── Push etiquette (so people don't uninstall) ────────────
//  • Quiet hours (IST, default 22:00–08:00): no phone push, in-app only.
//  • Daily cap (default 8 pushes/day) for normal notifications.
//  • Time-critical types (proof confirm, session) skip both limits —
//    missing them costs the user XP/trust.
//  • Chat: one notification per chat (newer message replaces older).
//  Counters are in memory → fine for a single API instance.
const QUIET_START = Number(process.env.PUSH_QUIET_START_HOUR ?? 22); // IST hour
const QUIET_END   = Number(process.env.PUSH_QUIET_END_HOUR ?? 8);
const DAILY_CAP   = Number(process.env.PUSH_DAILY_CAP ?? 8);
const CRITICAL_TYPES = new Set(['proof', 'session']);

const _istHour = (d = new Date()) =>
  Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' })
    .format(d)) % 24;
const _istDay = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d); // YYYY-MM-DD

const isQuietHours = (d = new Date()) => {
  const h = _istHour(d);
  return QUIET_START > QUIET_END ? (h >= QUIET_START || h < QUIET_END)
                                 : (h >= QUIET_START && h < QUIET_END);
};

const _pushCount = new Map(); // userId → { day, count }
const _allowPush = (userId, type) => {
  if (CRITICAL_TYPES.has(type)) return true;
  if (isQuietHours()) return false;
  const day = _istDay();
  const c = _pushCount.get(userId);
  if (!c || c.day !== day) { _pushCount.set(userId, { day, count: 1 }); return true; }
  if (c.count >= DAILY_CAP) return false;
  c.count++;
  return true;
};
// keep the map small
setInterval(() => {
  const day = _istDay();
  for (const [k, v] of _pushCount) if (v.day !== day) _pushCount.delete(k);
}, 60 * 60 * 1000).unref?.();

// Creates the in-app notification AND (if allowed) sends it as a phone push.
// Pass push:false to keep it in-app only.
const create = async ({
  userId, type, title, message, actionUrl = null, data = null, push: sendPush = true,
}) => {
  let row = null;
  try {
    row = await prisma.notification.create({
      data: { userId, type, title, message, actionUrl, data },
    });
  } catch (e) {
    logger.error('notification.create failed: ' + e.message);
  }
  if (sendPush && _allowPush(userId, type)) {
    push()?.sendRaw(userId, {
      title,
      body: message,
      data: { type, ...(actionUrl ? { actionUrl } : {}), ...(data || {}) },
      // one notification per chat on the lock screen
      collapseKey: type === 'chat' && data?.chatId ? `chat_${data.chatId}` : undefined,
    }).catch(() => {});
  }
  return row;
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

// ── Buddy proof confirmation (2h window) ───────────────
// Reminder #1 — right after proof upload
const notifyProofUploaded = (confirmerId, uploaderName, sessionId, extra = {}) =>
  create({ userId: confirmerId, type: 'proof',
    title: '📸 Proof aaya — confirm karo',
    message: `${uploaderName} ne session proof bheja. 2 ghante mein confirm karo — dono ko XP milega!`,
    actionUrl: `/sessions/${sessionId}/confirm`,
    data: { sessionId, kind: 'proof_confirm', ...extra },
  });

// Reminder #2 / #3 — sent by cron
const notifyProofConfirmReminder = (confirmerId, uploaderName, sessionId, minutesLeft, xp) =>
  create({ userId: confirmerId, type: 'proof',
    title: minutesLeft <= 15 ? '⚠️ Sirf 15 min bache!' : '⏳ Proof confirm pending',
    message: minutesLeft <= 15
      ? `${uploaderName} ka proof confirm karo — warna aapka +${xp} XP chala jayega.`
      : `${uploaderName} ka +${xp} XP aapke confirm ka wait kar raha hai.`,
    actionUrl: `/sessions/${sessionId}/confirm`,
    data: { sessionId, kind: 'proof_confirm', minutesLeft },
  });

// Timeout — confirmer missed it
const notifyProofConfirmMissed = (confirmerId, uploaderName, sessionId, xpLost) =>
  create({ userId: confirmerId, type: 'proof',
    title: '😔 Confirm miss ho gaya',
    message: `${uploaderName} ko XP mil gaya, aapka +${xpLost} XP chala gaya. Trust -2.`,
    actionUrl: `/sessions/${sessionId}`,
    data: { sessionId, kind: 'proof_confirm_missed' },
  });

// Timeout — uploader still gets credit
const notifyProofAutoCompleted = (uploaderId, confirmerName, sessionId, xp) =>
  create({ userId: uploaderId, type: 'session',
    title: '✅ Session complete',
    message: `${confirmerName} ne confirm nahi kiya, par aapka session complete ho gaya. +${xp} XP`,
    actionUrl: `/sessions/${sessionId}`,
    data: { sessionId, kind: 'proof_auto_completed' },
  });

module.exports = {
  create,
  isQuietHours,
  notifyProofUploaded,
  notifyProofConfirmReminder,
  notifyProofConfirmMissed,
  notifyProofAutoCompleted,
  notifyMatch,
  notifySessionScheduled,
  notifyProofRequired,
  notifyXpGained,
  notifyTokenLow,
};
