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

    // Mark as completed
    await prisma.referral.update({
      where: { id: ref.id },
      data: {
        referredId: userId,
        status:     'completed',
        rewardGiven: true,
      },
    });

    // Give 50 tokens to BOTH users
    await prisma.user.updateMany({
      where: { id: { in: [ref.referrerId, userId] } },
      data:  { chatTokens: { increment: 50 } },
    });

    // Notify referrer
    const newUser = await prisma.user.findUnique({
      where:  { id: userId },
      select: { firstName: true },
    });
    await notifSvc.send(ref.referrerId, 'referral_success', {
      name: newUser?.firstName || 'Someone',
    });

    return res_.success(res, null, '🎁 Referral applied! 50 tokens added to your account.');
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
        where: { referrerId: userId, status: 'pending' },
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

module.exports = { getMyCode, applyCode, getStats };
