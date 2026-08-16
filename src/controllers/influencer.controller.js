// ─────────────────────────────────────────────────────────
//  influencer.controller.js
//  Influencer application, verification, discover
// ─────────────────────────────────────────────────────────
const { PrismaClient } = require('@prisma/client');
const { v4: uuid }     = require('uuid');
const crypto           = require('crypto');
const prisma           = new PrismaClient();
const res_             = require('../utils/response');

// ── Generate verification code ────────────────────────────
const _genCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing chars
  let code = 'SESHLLY-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};

// ── USER: Apply as influencer ─────────────────────────────
// POST /api/influencer/apply
const apply = async (req, res, next) => {
  try {
    const { instagramHandle, claimedFollowers } = req.body;
    const userId = req.user.id;

    if (!instagramHandle || !claimedFollowers)
      return res_.error(res, 'Instagram handle and follower count required', 422);

    if (claimedFollowers < 50000)
      return res_.error(res, 'Minimum 50,000 followers required', 422);

    // Clean handle — remove @ if present
    const handle = instagramHandle.replace(/^@/, '').trim().toLowerCase();

    // Check existing application
    const existing = await prisma.influencerApplication.findUnique({
      where: { userId },
    });

    if (existing) {
      // Can they reapply?
      if (existing.status === 'approved')
        return res_.error(res, 'You are already a verified influencer', 409);

      if (existing.status === 'pending' || existing.status === 'code_added')
        return res_.error(res, 'Application already pending', 409);

      if (existing.status === 'rejected' && existing.canReapplyAt) {
        if (new Date() < new Date(existing.canReapplyAt))
          return res_.error(res,
            `You can reapply after ${new Date(existing.canReapplyAt).toLocaleDateString('en-IN')}`,
            429);
      }

      // Delete old rejected application — allow fresh apply
      await prisma.influencerApplication.delete({ where: { userId } });
    }

    const verificationCode = _genCode();
    const codeExpiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const application = await prisma.influencerApplication.create({
      data: {
        id: uuid(),
        userId,
        instagramHandle: handle,
        claimedFollowers,
        verificationCode,
        codeExpiresAt,
        status: 'pending',
      },
    });

    // Update user's influencerAppliedAt
    await prisma.user.update({
      where: { id: userId },
      data:  { influencerAppliedAt: new Date() },
    });

    // Send push notification + in-app notification with code
    await _sendCodeNotification(userId, verificationCode, handle, codeExpiresAt);

    return res_.created(res, {
      applicationId:    application.id,
      verificationCode: application.verificationCode,
      codeExpiresAt:    application.codeExpiresAt,
      instagramHandle:  application.instagramHandle,
      status:           'pending',
      instructions: [
        `Add "${verificationCode}" to your Instagram bio`,
        'Open Instagram → Edit Profile → Bio → Paste code',
        `You have 7 days to add the code`,
        'Once added, tap "I\'ve added it" in the app',
      ],
    }, 'Application submitted! Check your notifications for the verification code.');

  } catch (e) { next(e); }
};

// ── USER: Mark code as added ──────────────────────────────
// POST /api/influencer/code-added
const markCodeAdded = async (req, res, next) => {
  try {
    const application = await prisma.influencerApplication.findUnique({
      where: { userId: req.user.id },
    });

    if (!application)
      return res_.error(res, 'No application found', 404);
    if (application.status !== 'pending')
      return res_.error(res, 'Application already processed', 400);
    if (new Date() > new Date(application.codeExpiresAt))
      return res_.error(res, 'Verification code expired. Please reapply.', 410);

    await prisma.influencerApplication.update({
      where: { userId: req.user.id },
      data:  { status: 'code_added' },
    });

    // Notify Super Admin
    await _notifyAdmins(application);

    return res_.success(res, {}, 'Great! Admin will verify within 48 hours.');
  } catch (e) { next(e); }
};

// ── USER: Get my application status ──────────────────────
// GET /api/influencer/status
const getMyStatus = async (req, res, next) => {
  try {
    const application = await prisma.influencerApplication.findUnique({
      where: { userId: req.user.id },
    });

    if (!application)
      return res_.success(res, { applied: false });

    const hoursLeft = Math.max(0, Math.floor(
      (new Date(application.codeExpiresAt) - new Date()) / (1000 * 60 * 60)
    ));

    return res_.success(res, {
      applied:          true,
      status:           application.status,
      verificationCode: application.status === 'pending' || application.status === 'code_added'
                          ? application.verificationCode : null,
      instagramHandle:  application.instagramHandle,
      codeExpiresIn:    `${hoursLeft} hours`,
      codeExpired:      new Date() > new Date(application.codeExpiresAt),
      canReapplyAt:     application.canReapplyAt,
      rejectedReason:   application.rejectedReason,
    });
  } catch (e) { next(e); }
};

// ── USER: Discover influencers ────────────────────────────
// GET /api/influencer/discover
const discoverInfluencers = async (req, res, next) => {
  try {
    const { activity, city, page = 1 } = req.query;
    const take = 20;
    const skip = (Number(page) - 1) * take;

    const influencers = await prisma.user.findMany({
      where: {
        isInfluencer: true,
        deletedAt:    null,
        ...(activity ? { primaryActivity: activity } : {}),
        ...(city     ? { city }                      : {}),
      },
      select: {
        id:                true,
        firstName:         true,
        lastName:          true,
        avatarUrl:         true,
        city:              true,
        primaryActivity:   true,
        instagramHandle:   true,
        instagramFollowers: true,
        influencerBio:     true,
        trustScore:        true,
        level:             true,
        xpTotal:           true,
        instagramVerifiedAt: true,
        influencerSessionLimit: true,
      },
      orderBy: [
        { instagramFollowers: 'desc' },
        { trustScore: 'desc' },
      ],
      take, skip,
    });

    // For each influencer check if current user has remaining sessions
    const userId = req.user.id;
    const monthYear = _currentMonthYear();

    const sessionCounts = await prisma.influencerSession.findMany({
      where: {
        fanId:     userId,
        monthYear,
        influencerId: { in: influencers.map(i => i.id) },
      },
    });

    const sessionMap = {}; // { influencerId: sessionCount }
    sessionCounts.forEach(s => { sessionMap[s.influencerId] = s.sessionCount; });

    const isElite = req.user.subscriptionPlan === 'elite';

    return res_.success(res, {
      influencers: influencers.map(inf => ({
        ...inf,
        fullName:         `${inf.firstName} ${inf.lastName || ''}`.trim(),
        isLocked:         !isElite,   // Non-elite sees locked state
        sessionsUsed:     sessionMap[inf.id]    || 0,
        sessionsRemaining: inf.influencerSessionLimit - (sessionMap[inf.id] || 0),
        canBook:          isElite &&
                          (sessionMap[inf.id] || 0) < inf.influencerSessionLimit,
      })),
      isElite,
      page: Number(page),
    });
  } catch (e) { next(e); }
};

// ── USER: Get single influencer profile ───────────────────
// GET /api/influencer/:id
const getInfluencerProfile = async (req, res, next) => {
  try {
    const inf = await prisma.user.findFirst({
      where: { id: req.params.id, isInfluencer: true, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true,
        avatarUrl: true, city: true, primaryActivity: true,
        instagramHandle: true, instagramFollowers: true,
        influencerBio: true, trustScore: true,
        level: true, xpTotal: true,
        instagramVerifiedAt: true,
        influencerSessionLimit: true,
        // Stats
        sessionsAsUser: {
          where: { status: 'completed' },
          select: { id: true },
        },
      },
    });

    if (!inf) return res_.error(res, 'Influencer not found', 404);

    const monthYear  = _currentMonthYear();
    const isElite    = req.user.subscriptionPlan === 'elite';
    const fanSession = await prisma.influencerSession.findUnique({
      where: {
        influencerId_fanId_monthYear: {
          influencerId: inf.id,
          fanId:        req.user.id,
          monthYear,
        },
      },
    });

    return res_.success(res, {
      ...inf,
      fullName:          `${inf.firstName} ${inf.lastName || ''}`.trim(),
      totalSessions:     inf.sessionsAsUser.length,
      isLocked:          !isElite,
      sessionsUsed:      fanSession?.sessionCount || 0,
      sessionsRemaining: inf.influencerSessionLimit - (fanSession?.sessionCount || 0),
      canBook:           isElite &&
                         (fanSession?.sessionCount || 0) < inf.influencerSessionLimit,
    });
  } catch (e) { next(e); }
};

// ── ADMIN: Get all applications ───────────────────────────
// GET /api/admin/influencer/applications
const getApplications = async (req, res, next) => {
  try {
    const { status = 'code_added' } = req.query;
    const apps = await prisma.influencerApplication.findMany({
      where:   { status },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true,
            avatarUrl: true, email: true, city: true,
            primaryActivity: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res_.success(res, {
      applications: apps.map(a => ({
        ...a,
        instagramUrl: `https://instagram.com/${a.instagramHandle}`,
        isCodeExpired: new Date() > new Date(a.codeExpiresAt),
      })),
    });
  } catch (e) { next(e); }
};

// ── ADMIN: Approve application ────────────────────────────
// PUT /api/admin/influencer/:id/approve
const approveApplication = async (req, res, next) => {
  try {
    const { verifiedFollowers } = req.body; // Admin confirmed actual followers

    const app = await prisma.influencerApplication.findUnique({
      where: { id: req.params.id },
    });
    if (!app) return res_.error(res, 'Application not found', 404);
    if (app.status === 'approved')
      return res_.error(res, 'Already approved', 409);

    // Update user → isInfluencer = true
    await prisma.$transaction([
      prisma.user.update({
        where: { id: app.userId },
        data: {
          isInfluencer:       true,
          instagramHandle:    app.instagramHandle,
          instagramFollowers: verifiedFollowers || app.claimedFollowers,
          instagramVerifiedAt: new Date(),
        },
      }),
      prisma.influencerApplication.update({
        where: { id: app.id },
        data: {
          status:     'approved',
          reviewedBy: req.admin?.id || req.user?.id,
          reviewedAt: new Date(),
        },
      }),
    ]);

    // Notify user
    await _createNotification(app.userId,
      '🎉 You\'re now a Seshlly Influencer! Your profile is now live in Discover.',
      'influencer_approved'
    );

    return res_.success(res, {}, 'Influencer approved successfully');
  } catch (e) { next(e); }
};

// ── ADMIN: Reject application ─────────────────────────────
// PUT /api/admin/influencer/:id/reject
const rejectApplication = async (req, res, next) => {
  try {
    const { reason = 'Application did not meet requirements' } = req.body;

    const app = await prisma.influencerApplication.findUnique({
      where: { id: req.params.id },
    });
    if (!app) return res_.error(res, 'Application not found', 404);

    const canReapplyAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await prisma.influencerApplication.update({
      where: { id: app.id },
      data: {
        status:        'rejected',
        rejectedReason: reason,
        canReapplyAt,
        reviewedBy:    req.admin?.id || req.user?.id,
        reviewedAt:    new Date(),
      },
    });

    await _createNotification(app.userId,
      `Application not approved: ${reason}. You can reapply after 30 days.`,
      'influencer_rejected'
    );

    return res_.success(res, {}, 'Application rejected');
  } catch (e) { next(e); }
};

// ── ADMIN: Get all verified influencers ───────────────────
// GET /api/admin/influencer/list
const getVerifiedInfluencers = async (req, res, next) => {
  try {
    const influencers = await prisma.user.findMany({
      where:   { isInfluencer: true, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true,
        avatarUrl: true, email: true, city: true,
        primaryActivity: true, instagramHandle: true,
        instagramFollowers: true, trustScore: true,
        instagramVerifiedAt: true, influencerSessionLimit: true,
      },
      orderBy: { instagramFollowers: 'desc' },
    });

    return res_.success(res, { influencers });
  } catch (e) { next(e); }
};

// ── ADMIN: Revoke influencer status ───────────────────────
// PUT /api/admin/influencer/:id/revoke
const revokeInfluencer = async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        isInfluencer:       false,
        instagramVerifiedAt: null,
      },
    });

    await _createNotification(req.params.id,
      'Your Influencer status has been removed.',
      'influencer_revoked'
    );

    return res_.success(res, {}, 'Influencer status revoked');
  } catch (e) { next(e); }
};

// ── INFLUENCER SESSION LIMIT CHECK ───────────────────────
// Called by session.controller before booking
const checkInfluencerSessionLimit = async (fanId, influencerId) => {
  const inf = await prisma.user.findUnique({
    where:  { id: influencerId },
    select: { isInfluencer: true, influencerSessionLimit: true },
  });

  if (!inf?.isInfluencer) return { allowed: true }; // Not an influencer — no limit

  const monthYear = _currentMonthYear();
  const record    = await prisma.influencerSession.findUnique({
    where: {
      influencerId_fanId_monthYear: { influencerId, fanId, monthYear },
    },
  });

  const used      = record?.sessionCount || 0;
  const remaining = inf.influencerSessionLimit - used;

  return {
    allowed:   remaining > 0,
    used,
    remaining,
    limit:     inf.influencerSessionLimit,
    monthYear,
  };
};

// Called by session.controller AFTER session completed
const incrementInfluencerSessionCount = async (fanId, influencerId) => {
  const monthYear = _currentMonthYear();
  await prisma.influencerSession.upsert({
    where:  { influencerId_fanId_monthYear: { influencerId, fanId, monthYear } },
    update: { sessionCount: { increment: 1 } },
    create: {
      id: uuid(), influencerId, fanId, monthYear, sessionCount: 1,
    },
  });
};

// ── INSTAGRAM OAUTH (AUTOMATIC — COMMENTED OUT) ───────────
/*
 * PHASE 2: Uncomment when Instagram App is ready
 *
 * Steps to activate:
 * 1. Create app at developers.facebook.com
 * 2. Add to .env:
 *    INSTAGRAM_CLIENT_ID=your_client_id
 *    INSTAGRAM_CLIENT_SECRET=your_client_secret
 *    INSTAGRAM_REDIRECT_URI=https://seshlly.com/auth/instagram/callback
 * 3. Uncomment below and add routes

const INSTAGRAM_CLIENT_ID     = process.env.INSTAGRAM_CLIENT_ID;
const INSTAGRAM_CLIENT_SECRET = process.env.INSTAGRAM_CLIENT_SECRET;
const INSTAGRAM_REDIRECT_URI  = process.env.INSTAGRAM_REDIRECT_URI;

// GET /api/influencer/instagram/auth-url
const getInstagramAuthUrl = async (req, res, next) => {
  const url = `https://api.instagram.com/oauth/authorize?` +
    `client_id=${INSTAGRAM_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(INSTAGRAM_REDIRECT_URI)}` +
    `&scope=user_profile,user_media` +
    `&response_type=code`;
  return res_.success(res, { url });
};

// POST /api/influencer/instagram/verify  { code: 'instagram_oauth_code' }
const verifyInstagram = async (req, res, next) => {
  try {
    const { code } = req.body;

    // Exchange code for access token
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id:     INSTAGRAM_CLIENT_ID,
        client_secret: INSTAGRAM_CLIENT_SECRET,
        grant_type:    'authorization_code',
        redirect_uri:  INSTAGRAM_REDIRECT_URI,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Token exchange failed');

    // Fetch user profile
    const profileRes = await fetch(
      `https://graph.instagram.com/me?fields=id,username,followers_count&access_token=${tokenData.access_token}`
    );
    const profile = await profileRes.json();

    if ((profile.followers_count || 0) < 50000)
      return res_.error(res, `${profile.followers_count} followers found. Minimum 50,000 required.`, 422);

    // Auto approve — no admin needed
    await prisma.$transaction([
      prisma.user.update({
        where: { id: req.user.id },
        data: {
          isInfluencer:       true,
          instagramHandle:    profile.username,
          instagramFollowers: profile.followers_count,
          instagramVerifiedAt: new Date(),
        },
      }),
      prisma.influencerApplication.upsert({
        where:  { userId: req.user.id },
        update: { status: 'approved', reviewedAt: new Date() },
        create: {
          id: uuid(), userId: req.user.id,
          instagramHandle: profile.username,
          claimedFollowers: profile.followers_count,
          verificationCode: 'OAUTH_VERIFIED',
          codeExpiresAt: new Date(),
          status: 'approved',
          reviewedAt: new Date(),
        },
      }),
    ]);

    await _createNotification(req.user.id,
      '🎉 Instagram verified! You\'re now a Seshlly Influencer!',
      'influencer_approved'
    );

    return res_.success(res, { verified: true, followers: profile.followers_count });
  } catch (e) { next(e); }
};
*/

// ── Helpers ───────────────────────────────────────────────
const _currentMonthYear = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const _createNotification = async (userId, message, type) => {
  try {
    await prisma.notification.create({
      data: {
        id: uuid(), userId, type,
        title: message, body: message,
        data: '{}', isRead: false,
      },
    });
  } catch (_) {}
};

const _sendCodeNotification = async (userId, code, handle, expiresAt) => {
  await _createNotification(userId,
    `Your Influencer verification code: ${code}\n` +
    `Add it to your Instagram bio @${handle} within 7 days.`,
    'influencer_code'
  );
};

const _notifyAdmins = async (application) => {
  // Notify all super admins
  const admins = await prisma.adminUser.findMany({
    where:  { role: 'super_admin', status: 'active' },
    select: { id: true },
  });
  // In production: send push/email to admins
  // For now: log
  console.log(`[INFLUENCER] New application ready for review: @${application.instagramHandle}`);
};

module.exports = {
  apply, markCodeAdded, getMyStatus,
  discoverInfluencers, getInfluencerProfile,
  getApplications, approveApplication,
  rejectApplication, getVerifiedInfluencers,
  revokeInfluencer,
  checkInfluencerSessionLimit,
  incrementInfluencerSessionCount,
};
