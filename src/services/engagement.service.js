'use strict';
// ─────────────────────────────────────────────────────────
//  engagement.service.js — retention nudges (called by cron)
//
//  1. sendSessionStartReminders  (every 5 min)
//     "⏰ Session in 1 hour — Rahul is counting on you"
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
        title:  '⏰ Session in 1 hour',
        message: p.other
          ? `${s.activity}${where} — ${p.other} is counting on you. Be on time! 💪`
          : `${s.activity}${where} — get ready! 💪`,
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
    title: `💪 ${u.firstName}, your buddies are training`,
    message: 'Your buddies are active today — send a Flash or plan a session.',
  }),
  7: (u) => ({
    title: '🔥 It\'s been a week!',
    message: 'Schedule a session today — restart your streak and earn XP.',
  }),
  14: (u) => ({
    title: u.city ? `👀 New gym buddies in ${u.city}` : '👀 New gym buddies have joined',
    message: 'See who matches your level and activity — open Discover.',
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

// ── 3. Weekly recap — Sunday ~7 PM IST ───────────────────
// "This week: 3 sessions · 240 XP · #4 in Noida". Built from the XP log of the
// last 7 days (weeklyXp is reset on Saturday night, so it can't be used).
const sendWeeklyRecap = async () => {
  const since = new Date(Date.now() - 7 * DAY);
  const sums = await prisma.xpEvent.groupBy({
    by: ['userId'], where: { createdAt: { gte: since } }, _sum: { xpAmount: true },
  });
  const xpOf = new Map(sums.map(r => [r.userId, r._sum.xpAmount || 0]));
  if (!xpOf.size) return { sent: 0 };
  const users = await prisma.user.findMany({
    where: { id: { in: [...xpOf.keys()] }, status: 'ACTIVE', isBanned: false },
    select: { id: true, firstName: true, city: true },
  });
  // city rank among people who earned XP this week
  const byCity = new Map();
  for (const u of users) {
    const k = (u.city || '').trim().toLowerCase();
    if (!k) continue;
    if (!byCity.has(k)) byCity.set(k, []);
    byCity.get(k).push(u.id);
  }
  for (const ids of byCity.values()) ids.sort((a, b) => xpOf.get(b) - xpOf.get(a));

  // Session counts for everyone in 3 grouped queries (was 1 query per user:
  // 6.7 s for 1000 users in the load test)
  const ids = users.map(u => u.id);
  const doneWhere = { status: 'completed', endTime: { gte: since } };
  const sessOf = new Map(ids.map(id => [id, new Set()]));
  const add = (uid, sid) => sessOf.get(uid)?.add(sid);
  const [asHost, asBuddy, asGuest] = await Promise.all([
    prisma.workoutSession.findMany({ where: { ...doneWhere, userId: { in: ids } }, select: { id: true, userId: true } }),
    prisma.workoutSession.findMany({ where: { ...doneWhere, buddyId: { in: ids } }, select: { id: true, buddyId: true } }),
    prisma.sessionParticipant.findMany({ where: { userId: { in: ids }, status: 'confirmed', session: doneWhere },
      select: { userId: true, sessionId: true } }),
  ]);
  asHost.forEach(r => add(r.userId, r.id));
  asBuddy.forEach(r => add(r.buddyId, r.id));
  asGuest.forEach(r => add(r.userId, r.sessionId));

  let sent = 0;
  for (const u of users) {
    const xp = xpOf.get(u.id);
    if (xp <= 0) continue;
    const sessions = sessOf.get(u.id).size;
    const k = (u.city || '').trim().toLowerCase();
    const rank = k ? byCity.get(k).indexOf(u.id) + 1 : 0;
    const parts = [`${sessions} session${sessions === 1 ? '' : 's'}`, `${xp} XP`];
    if (rank) parts.push(`#${rank} in ${u.city.trim()}`);
    await notifSvc.create({
      userId: u.id, type: 'xp',
      title: `📊 Your week, ${u.firstName}`,
      message: `${parts.join(' · ')}. Plan next week's first session now!`,
      data: { kind: 'weekly_recap', sessions, xp, rank },
    });
    sent++;
  }
  logger.info(`[engagement] weekly recaps sent: ${sent}`);
  return { sent };
};

module.exports = { sendSessionStartReminders, sendWinbackNudges, sendWeeklyRecap };
