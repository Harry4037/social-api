'use strict';
// ─────────────────────────────────────────────────────────
//  routes/index.js  — all non-auth, non-admin routers
//  Exported and mounted in server.js
// ─────────────────────────────────────────────────────────
const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticate, requirePro } = require('../middleware/auth');
const { validate, swipeLimiter } = require('../middleware/middleware');
const { upload } = require('../middleware/upload');
const prisma = require('../config/db');

const userCtrl      = require('../controllers/user.controller');
const matchCtrl     = require('../controllers/match.controller');
const sessCtrl      = require('../controllers/session.controller');
const chatCtrl      = require('../controllers/chat.controller');
const notifCtrl     = require('../controllers/notification.controller');
const subCtrl       = require('../controllers/subscription.controller');
const upCtrl        = require('../controllers/upload.controller');
const challengeCtrl = require('../controllers/challenge.controller');
const referralCtrl  = require('../controllers/referral.controller');
const brandAdsCtrl  = require('../controllers/brand_ads.controller');
const verifCtrl     = require('../controllers/verification.controller');
const waitlistCtrl  = require('../controllers/waitlist.controller');
const flashCtrl     = require('../controllers/flash_streak.controller');
const safetyCtrl    = require('../controllers/safety.controller');
const gymCtrl       = require('../controllers/gym.controller');

const challengeRouter = require('./challenge.routes');

// ── /users ────────────────────────────────────────────────
const userRouter = express.Router();
userRouter.put('/me', authenticate, [
  body('firstName').optional().trim().notEmpty(),
  body('lastName').optional().trim().notEmpty(),
  body('username').optional().trim().isLength({ min: 3, max: 30 })
    .matches(/^[a-z0-9_]+$/i).withMessage('Username: letters, numbers, underscores only'),
  body('bio').optional().trim().isLength({ max: 500 }),
  body('city').optional().trim(),
  body('activities').optional().isArray(),
  body('goals').optional().isArray(),
  body('latitude').optional().isFloat({ min: -90, max: 90 }),
  body('longitude').optional().isFloat({ min: -180, max: 180 }),
], validate, userCtrl.updateProfile);

userRouter.get('/:id/profile', authenticate, [param('id').isUUID()], validate, userCtrl.getBuddyProfile);

userRouter.get('/me/photos', authenticate, async (req, res, next) => {
  try {
    const photos = await prisma.userPhoto.findMany({
      where: { userId: req.user.id },
      orderBy: { order: 'asc' },
    });
    return res.json({ success: true, data: { photos } });
  } catch (e) { next(e); }
});

userRouter.post('/me/photos', authenticate, async (req, res, next) => {
  try {
    const count = await prisma.userPhoto.count({ where: { userId: req.user.id } });
    if (count >= 5)
      return res.status(400).json({ success: false, message: 'Maximum 5 photos allowed' });
    const photo = await prisma.userPhoto.create({
      data: {
        id: require('uuid').v4(),
        userId: req.user.id,
        url: req.body.url,
        order: count,
      },
    });
    return res.status(201).json({ success: true, data: { photo } });
  } catch (e) { next(e); }
});

userRouter.delete('/me/photos/:photoId', authenticate, async (req, res, next) => {
  try {
    await prisma.userPhoto.deleteMany({
      where: { id: req.params.photoId, userId: req.user.id },
    });
    return res.json({ success: true, message: 'Photo deleted' });
  } catch (e) { next(e); }
});

userRouter.post('/fcm-token', authenticate, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ success: false });
    await prisma.user.update({ where: { id: req.user.id }, data: { fcmToken } });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false });
  }
});

// ── /match ────────────────────────────────────────────────
const matchRouter = express.Router();
matchRouter.get('/discover', authenticate, matchCtrl.discover);
matchRouter.post('/like', authenticate, swipeLimiter, [
  body('targetUserId').isUUID().withMessage('Valid targetUserId required'),
], validate, matchCtrl.like);
matchRouter.post('/skip', authenticate, swipeLimiter, [
  body('targetUserId').isUUID().withMessage('Valid targetUserId required'),
], validate, matchCtrl.skip);
matchRouter.get('/buddies', authenticate, matchCtrl.getBuddies);
matchRouter.delete('/buddies/:buddyId', authenticate, [param('buddyId').isUUID()], validate, matchCtrl.removeBuddy);
matchRouter.post('/nudge/:buddyId', authenticate, [param('buddyId').isUUID()], validate, async (req, res) => {
  try {
    return res.json({ success: true, data: { nudged: true } });
  } catch (e) { res.status(500).json({ success: false, message: 'Nudge failed' }); }
});
matchRouter.post('/boost',       authenticate, matchCtrl.boost);
matchRouter.get('/boost/status', authenticate, matchCtrl.boostStatus);

// Guard: register swipe/request routes only if controller has them (safe after merge)
if (typeof matchCtrl.swipe === 'function') {
  matchRouter.post('/swipe', authenticate, swipeLimiter, [
    body('targetId').isUUID().withMessage('Valid targetId required'),
    body('action').optional().isIn(['like', 'skip', 'super_like']),
  ], validate, matchCtrl.checkSuperLikeLimit, matchCtrl.swipe);
}
if (typeof matchCtrl.getMatchRequests === 'function') {
  matchRouter.get('/requests', authenticate, matchCtrl.getMatchRequests);
  matchRouter.post('/requests/:swipeId/accept', authenticate, [param('swipeId').isUUID()], validate, matchCtrl.acceptRequest);
  matchRouter.post('/requests/:swipeId/decline', authenticate, [param('swipeId').isUUID()], validate, matchCtrl.declineRequest);
}

// ── /sessions ─────────────────────────────────────────────
const sessionRouter = express.Router();
sessionRouter.post('/', authenticate, [
  body('activity').notEmpty().withMessage('Activity is required'),
  body('scheduledAt').isISO8601().withMessage('scheduledAt must be ISO 8601'),
  body('buddyId').optional().isUUID(),
  body('gymName').optional().trim(),
], validate, sessCtrl.scheduleSession);
sessionRouter.get('/my', authenticate, sessCtrl.getMySessions);
sessionRouter.get('/pending-confirm', authenticate, sessCtrl.getPendingConfirmations);
sessionRouter.post('/:id/proof', authenticate, [
  param('id').isUUID(),
  body('proofImageUrl').notEmpty().isURL().withMessage('Valid image URL required'),
], validate, sessCtrl.uploadProof);
sessionRouter.post('/:id/confirm', authenticate, [param('id').isUUID()], validate, sessCtrl.confirmSession);
sessionRouter.post('/:id/respond', authenticate, [
  param('id').isUUID(),
  body('action').isIn(['confirm', 'decline']),
], validate, sessCtrl.respondToInvite);

// ── /chat ─────────────────────────────────────────────────
const chatRouter = express.Router();
chatRouter.get('/', authenticate, chatCtrl.getChats);
chatRouter.get('/:chatId/messages', authenticate, [param('chatId').isUUID()], validate, chatCtrl.getMessages);
chatRouter.post('/:chatId/messages', authenticate, [
  param('chatId').isUUID(),
  body('content').notEmpty().isLength({ max: 5000 }),
  body('type').optional().isIn(['text', 'image', 'session_invite', 'proof']),
], validate, chatCtrl.sendMessage);
chatRouter.patch('/:chatId/read', authenticate, [param('chatId').isUUID()], validate, chatCtrl.markRead);
chatRouter.patch('/:chatId/mode', authenticate, [
  param('chatId').isUUID(),
  body('disappearing').isBoolean().withMessage('disappearing must be true/false'),
], validate, chatCtrl.setMode);

// ── /notifications ────────────────────────────────────────
const notifRouter = express.Router();
notifRouter.get('/', authenticate, notifCtrl.getNotifications);
notifRouter.patch('/read-all', authenticate, notifCtrl.markAllRead);
notifRouter.patch('/:id/read', authenticate, [param('id').isUUID()], validate, notifCtrl.markRead);

// ── /subscriptions ────────────────────────────────────────
const subRouter = express.Router();
subRouter.get('/plans', subCtrl.getPlans);
subRouter.post('/order', authenticate, [body('planId').isUUID()], validate, subCtrl.createOrder);
subRouter.post('/verify-payment', authenticate, [
  body('razorpay_order_id').notEmpty(),
  body('razorpay_payment_id').notEmpty(),
  body('razorpay_signature').notEmpty(),
], validate, subCtrl.verifyPayment);

// ── /tokens ───────────────────────────────────────────────
const tokensRouter = express.Router();
tokensRouter.post('/buy', authenticate, [
  body('pack').isIn([10, 20, 50]).withMessage('Pack must be 10, 20, or 50'),
], validate, subCtrl.buyTokens);

// ── /upload ───────────────────────────────────────────────
const uploadRouter = express.Router();
uploadRouter.post('/', authenticate, upload.single('file'), upCtrl.uploadFile);

// ── /global-leaderboard ───────────────────────────────────
const globalLeaderboardRouter = express.Router();
globalLeaderboardRouter.get('/', authenticate, challengeCtrl.getGlobalLeaderboard);

// ── /leaderboard (per-challenge) ──────────────────────────
// The app calls GET /leaderboard?challengeId=&city= — it was never mounted (404).
const leaderboardRouter = express.Router();
leaderboardRouter.get('/', authenticate, challengeCtrl.getLeaderboard);

// ── /feed ─────────────────────────────────────────────────
const feedRouter = express.Router();
feedRouter.get('/', authenticate, challengeCtrl.getGlobalFeed);
feedRouter.post('/', authenticate, [
  body('challengeId').isUUID(),
  body('stationTitle').notEmpty(),
  body('sessionId').optional().isUUID(),
], validate, challengeCtrl.postToFeed);

// ── /referral ─────────────────────────────────────────────
const referralRouter = express.Router();
referralRouter.get('/my-code', authenticate, referralCtrl.getMyCode);
referralRouter.post('/apply',  authenticate, referralCtrl.applyCode);
referralRouter.get('/stats',   authenticate, referralCtrl.getStats);

// ── /brand-ads (user-facing only) ────────────────────────
// Admin CRUD is in admin.routes.js under /admin/brand-ads
const brandAdsRouter = express.Router();
brandAdsRouter.get('/active',            authenticate, brandAdsCtrl.getActiveAd);
brandAdsRouter.post('/:id/impression',   authenticate, brandAdsCtrl.trackImpression);
brandAdsRouter.post('/:id/click',        authenticate, brandAdsCtrl.trackClick);

// ── /verification (user-facing only) ─────────────────────
// Admin queue is in admin.routes.js under /admin/verifications
const verifRouter = express.Router();
verifRouter.post('/submit',  authenticate, verifCtrl.submit);
verifRouter.get('/status',   authenticate, verifCtrl.getStatus);

// ── /waitlist (user-facing only) ─────────────────────────
// Admin management is in admin.routes.js under /admin/waitlist
const waitlistRouter = express.Router();
waitlistRouter.post('/join', authenticate, waitlistCtrl.join);

// ── /flash ────────────────────────────────────────────────
const flashRouter = express.Router();
flashRouter.post('/send',        authenticate, flashCtrl.recordFlashSent);
flashRouter.get('/streaks',      authenticate, flashCtrl.getMyStreaks);
flashRouter.get('/streak/:buddyId', authenticate, flashCtrl.getPairStreak);

// ── /safety — block & report ─────────────────────────────
const safetyRouter = express.Router();
safetyRouter.post('/block', authenticate, [body('userId').isUUID()], validate, safetyCtrl.block);
safetyRouter.delete('/block/:userId', authenticate, [param('userId').isUUID()], validate, safetyCtrl.unblock);
safetyRouter.get('/blocked', authenticate, safetyCtrl.listBlocked);
safetyRouter.post('/report', authenticate, [
  body('userId').isUUID(),
  body('reason').isIn(safetyCtrl.REPORT_REASONS),
  body('details').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  body('context').optional({ nullable: true }).isIn(['chat', 'profile', 'discover', 'map', 'feed']),
], validate, safetyCtrl.report);

// ── /gyms — Gym map + buddy check-ins ────────────────────
const gymRouter = express.Router();
gymRouter.get('/nearby', authenticate, [
  query('lat').isFloat({ min: -90, max: 90 }),
  query('lng').isFloat({ min: -180, max: 180 }),
  query('radius').optional().isInt({ min: 100, max: 50000 }),
], validate, gymCtrl.nearby);
gymRouter.get('/buddies', authenticate, gymCtrl.buddiesActive);
gymRouter.get('/checkin/me', authenticate, gymCtrl.myCheckin);
gymRouter.post('/checkin', authenticate, [
  body('placeId').isString().notEmpty(),
  body('gymName').isString().notEmpty(),
  body('lat').isFloat({ min: -90, max: 90 }),
  body('lng').isFloat({ min: -180, max: 180 }),
], validate, gymCtrl.checkIn);
gymRouter.delete('/checkin', authenticate, gymCtrl.checkOut);

module.exports = {
  gymRouter,
  safetyRouter,
  userRouter,
  matchRouter,
  sessionRouter,
  chatRouter,
  notifRouter,
  subRouter,
  tokensRouter,
  uploadRouter,
  challengeRouter,
  globalLeaderboardRouter,
  leaderboardRouter,
  feedRouter,
  referralRouter,
  brandAdsRouter,
  verifRouter,
  waitlistRouter,
  flashRouter,
};
