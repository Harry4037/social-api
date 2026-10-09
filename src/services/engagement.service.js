'use strict';
// ─────────────────────────────────────────────────────────
//  engagement.service.js — retention nudges (called by cron)
//
//  1. sendSessionStartReminders  (every 5 min)
//     "⏰ 1 ghante mein session — Rahul wait karega"
//  2. sendWinbackNudges          (daily ~7 PM IST)
//     Users inactive exactly 3 / 7 / 14 days get ONE friendly message.
//     Day-windows mean nobody gets the same nudge twice.
// ─────────────────────────────────────────────────────────
const prisma   = require('../config/db');
const notifSvc = require('./notification.service');
const logger   = require('../config/logger');

const DAY = 24 * 60 * 60 * 1000;

// ── 1. Session starts in ~1 hour ─────────────────────────
const sendSessionStartReminders = async () => {
  const now  = Date.now();
  const from = new Date(now + 50 * 60 * 1000);  // 50–65 min ahead (cron runs every 5)
  const to   = new Date(now + 65 * 60 * 1000);

  const sessions = await prisma.workoutSession.findMany({
    where: {
      status: 'scheduled',
      startReminderSentAt: null,
      scheduledAt: { gte: from, lte: to },
    },
    include: {
      user:  { select: { id: true, firstName: true } },
      buddy: { select: { id: true, firstName: true } },
      participants: {
        where:   { status: 'confirmed' },
        include: { user: { select: { id: true, firstName: true } } },
      },
    },
  });

  let sent = 0;
  for (const s of sessions) {
    // claim first → no duplicates even if two crons overlap
    const claim = await prisma.workoutSession.updateMany({
      where: { id: s.id, startReminderSentAt: null },
      data:  { startReminderSentAt: new Date() },
    });
    if (!claim.count) continue;

    const where = s.gymName ? ` @ ${s.gymName}` : '';
    const people = [
      s.user && { id: s.user.id, other: s.buddy?.firstName },
      s.buddy && { id: s.buddy.id, other: s.user?.firstName },
      ...s.participants
        .filter(p => p.user && p.user.id !== s.userId && p.user.id !== s.buddyId)
        .map(p => ({ id: p.user.id, other: s.user?.firstName })),
    ].filter(Boolean);

    for (const p of people) {
      await notifSvc.create({
        userId: p.id,
        type:   'session',
        title:  '⏰ Session 1 ghante mein',
        message: p.other
          ? `${s.activity}${where} — ${p.other} wait karega. Time pe pahuncho! 💪`
          : `${s.activity}${where} — ready ho jao! 💪`,
        actionUrl: `/sessions/${s.id}`,
        data: { sessionId: s.id, kind: 'session_start' },
      });
      sent++;
    }
  }
  return { sessions: sessions.length, sent };
};

// ── 2. Win-back: inactive 3 / 7 / 14 days ────────────────
const WINBACK = {
  3: (u) => ({
    title: `💪 ${u.firstName}, buddies train kar rahe hain`,
    message: 'Tumhare buddies aaj active hain — ek Flash bhejo ya session plan karo.',
  }),
  7: (u) => ({
    title: '🔥 Ek hafta ho gaya!',
    message: 'Aaj ek session schedule karo — streak dobara shuru karo aur XP kamao.',
  }),
  14: (u) => ({
    title: u.city ? `👀 ${u.city} mein naye gym buddies` : '👀 Naye gym buddies join hue hain',
    message: 'Dekho kaun tumhare level aur activity ka hai — Discover kholo.',
  }),
};

const sendWinbackNudges = async () => {
  const now = Date.now();
  let sent = 0;
  for (const days of Object.keys(WINBACK).map(Number)) {
    // lastActiveAt between (days+1) and days ago → exactly that day
    const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        isBanned: false,
        lastActiveAt: { gte: new Date(now - (days + 1) * DAY), lt: new Date(now - days * DAY) },
      },
      select: { id: true, firstName: true, city: true },
      take: 5000,
    });
    for (const u of users) {
      const { title, message } = WINBACK[days](u);
      await notifSvc.create({
        userId: u.id, type: 'system', title, message,
        data: { kind: 'winback', days },
      });
      sent++;
    }
  }
  logger.info(`[engagement] win-back nudges sent: ${sent}`);
  return { sent };
};

module.exports = { sendSessionStartReminders, sendWinbackNudges };
