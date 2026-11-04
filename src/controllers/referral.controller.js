'use strict';
// ─────────────────────────────────────────────────────────
//  referral.controller.js
//  Referral Module — Invite friends, earn tokens
// ─────────────────────────────────────────────────────────
const { v4: uuid } = require('uuid');
const prisma        = require('../config/db');
const res_          = require('../utils/response');
const notifSvc      = require('../services/notification.service');

// ── Generate unique referral code ────────────────────────
const _genCode = (userId) =>
  'SESH' +
  userId.slice(0, 4).toUpperCase() +
  Math.random().toString(36).slice(2, 6).toUpperCase();

// ── GET /referral/my-code ─────────────────────────────────
// Get or create referral code for logged in user
const getMyCode = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Check if code already exists
    let ref = await prisma.referral.findFirst({
      where: { referrerId: userId, referredId: null },
    });

    // Create if not exists
    if (!ref) {
      ref = await prisma.referral.create({
        data: {
          id:         uuid(),
          referrerId: userId,
          code:       _genCode(userId),
        },
      });
    }

    // Count completed referrals
    const completed = await prisma.referral.count({
      where: { referrerId: userId, status: 'completed' },
    });

    return res_.success(res, {
      code:      ref.code,
      completed,
      shareText: `Join me on Seshlly — India's first fitness buddy app! Use my code ${ref.code} to get 50 free tokens. Download: seshlly.com`,
    });
  } catch(e) { next(e); }
};

// ── POST /referral/apply ──────────────────────────────────
// Apply referral code on signup
const applyCode = async (req, res, next) => {
  try {
    const userId       = req.user.id;
    const { code }     = req.body;

    if (!code) return res_.error(res, 'Referral code required', 400);

    // Only new accounts (first 7 days) can use a referral code
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    if (!me || Date.now() - new Date(me.createdAt).getTime() > 7 * 24 * 3600e3) {
      return res_.error(res, 'Referral codes can only be used in your first week', 400);
    }

    // Find referral
    const ref = await prisma.referral.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!ref)
      return res_.error(res, 'Invalid referral code', 400);
    if (ref.referredId)
      return res_.error(res, 'This code has already been used', 400);
    if (ref.referrerId === userId)
      return res_.error(res, 'Cannot use your own referral code', 400);

    // Check user hasn't used any referral before
    const alreadyUsed = await prisma.referral.findFirst({
      where: { referredId: userId },
    });
    if (alreadyUsed)
      return res_.error(res, 'You have already used a referral code', 400);

    // Mark as completed — atomic, and referredId is UNIQUE, so parallel
    // requests (or two codes at once) can only ever pay out once
    let claimed = 0;
    try {
      const r = await prisma.referral.updateMany({
        where: { id: ref.id, referredId: null },
        // Reward is paid later, after the new user's first completed workout
        data: { referredId: userId, status: 'pending', rewardGiven: false },
      });
      claimed = r.count;
    } catch (e) {
      if (e.code === 'P2002' || /Unique constraint|Duplicate entry/i.test(e.message)) claimed = 0;
      else throw e;
    }
    if (!claimed) return res_.error(res, 'You have already used a referral code', 400);

    // No instant tokens: fake sign-ups used to farm 50 tokens each.
    return res_.success(res, { rewardPending: true },
      '🎁 Code applied! You both get 50 tokens after your first completed workout.');
  } catch(e) { next(e); }
};

// ── GET /referral/stats — my referral stats ───────────────
const getStats = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [myCode, completed, pending] = await Promise.all([
      prisma.referral.findFirst({
        where: { referrerId: userId, referredId: null },
      }),
      prisma.referral.count({
        where: { referrerId: userId, status: 'completed' },
      }),
      prisma.referral.count({
        where: { referrerId: userId, status: 'pending', referredId: { not: null } },
      }),
    ]);

    return res_.success(res, {
      code:           myCode?.code || null,
      totalReferrals: completed,
      pendingReferrals: pending,
      tokensEarned:   completed * 50,
    });
  } catch(e) { next(e); }
};

// Called when a user completes a workout: pays a pending referral (once)
const rewardReferral = async (userId) => {
  try {
    // Only real people: the new user must have verified their email
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
    if (!u?.emailVerified) return false;
    const ref = await prisma.referral.findFirst({
      where: { referredId: userId, rewardGiven: false },
      select: { id: true, referrerId: true },
    });
    if (!ref) return false;
    const claim = await prisma.referral.updateMany({
      where: { id: ref.id, rewardGiven: false },
      data:  { rewardGiven: true, status: 'completed' },
    });
    if (!claim.count) return false;
    await prisma.user.updateMany({
      where: { id: { in: [ref.referrerId, userId] } },
      data:  { chatTokens: { increment: 50 } },
    });
    const newUser = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } });
    await notifSvc.create({ userId: ref.referrerId, type: 'token', title: 'Referral bonus! 🎁',
      message: `${newUser?.firstName || 'Your friend'} finished their first workout — +50 tokens` });
    await notifSvc.create({ userId, type: 'token', title: 'Referral bonus! 🎁',
      message: 'First workout done — +50 tokens added' });
    return true;
  } catch (e) {
    console.error('[rewardReferral]', e.message);
    return false;
  }
};

// After email verification: pay if they already finished a workout
const rewardReferralIfEarned = async (userId) => {
  const done = await prisma.workoutSession.count({
    where: { status: 'completed', OR: [{ userId }, { buddyId: userId }] },
  });
  return done > 0 ? rewardReferral(userId) : false;
};

module.exports = { getMyCode, applyCode, getStats, rewardReferral, rewardReferralIfEarned };
