'use strict';
// ── user.routes.js ────────────────────────────────────────
const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticate, requireToken, requirePro } = require('../middleware/auth');
const { validate, swipeLimiter } = require('../middleware/middleware');
const { upload } = require('../middleware/upload');
const prisma = require('../config/db');

const userCtrl = require('../controllers/user.controller');
const matchCtrl = require('../controllers/match.controller');
const sessCtrl = require('../controllers/session.controller');
const chatCtrl = require('../controllers/chat.controller');
const notifCtrl = require('../controllers/notification.controller');
const subCtrl = require('../controllers/subscription.controller');
const upCtrl = require('../controllers/upload.controller');
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

userRouter.get('/:id/profile', authenticate, [
  param('id').isUUID(),
], validate, userCtrl.getBuddyProfile);

// GET /api/users/me/photos
userRouter.get('/me/photos', authenticate, async (req, res) => {
  try {
    const photos = await prisma.userPhoto.findMany({
      where: { userId: req.user.id },
      orderBy: { order: 'asc' },
    });
    return res.json({ success: true, data: { photos } });
  } catch (e) { next(e); }
});

// POST /api/users/me/photos — max 5
userRouter.post('/me/photos', authenticate, async (req, res) => {
  try {
    const count = await prisma.userPhoto.count({
      where: { userId: req.user.id }
    });
    if (count >= 5)
      return res.status(400).json({ success: false, message: 'Maximum 5 photos allowed' });

    const photo = await prisma.userPhoto.create({
      data: {
        id: require('uuid').v4(),
        userId: req.user.id,
        url: req.body.url,
        order: count,
      }
    });
    return res.status(201).json({ success: true, data: { photo } });
  } catch (e) { next(e); }
});

// DELETE /api/users/me/photos/:photoId
userRouter.delete('/me/photos/:photoId', authenticate, async (req, res) => {
  try {
    await prisma.userPhoto.deleteMany({
      where: { id: req.params.photoId, userId: req.user.id }
    });
    return res.json({ success: true, message: 'Photo deleted' });
  } catch (e) { next(e); }
});

// POST /api/users/fcm-token
userRouter.post('/fcm-token', authenticate, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ success: false });

    await prisma.user.update({
      where: { id: req.user.id },
      data: { fcmToken },
    });

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
matchRouter.delete('/buddies/:buddyId', authenticate, [
  param('buddyId').isUUID(),
], validate, matchCtrl.removeBuddy);

// Nudge a buddy (used by ChallengeBloc.nudgeBuddy)
matchRouter.post('/nudge/:buddyId', authenticate, [
  param('buddyId').isUUID(),
], validate, async (req, res) => {
  try {
    const { success } = require('../utils/response');
    return success(res, { nudged: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Nudge failed' });
  }
});

// ── NEW: Swipe + Match Requests ──────────────────────────
// Requires match_controller_addon.js merged into match.controller.js
// Guard: only register if functions exist (prevents crash if not merged yet)
if (typeof matchCtrl.swipe === 'function') {
  matchRouter.post('/swipe', authenticate, swipeLimiter, [
    body('targetId').isUUID().withMessage('Valid targetId required'),
    body('action').optional().isIn(['like', 'skip', 'super_like']),
  ], validate, matchCtrl.swipe);
}
if (typeof matchCtrl.getMatchRequests === 'function') {
  matchRouter.get('/requests', authenticate, matchCtrl.getMatchRequests);
  matchRouter.post('/requests/:swipeId/accept', authenticate, [
    param('swipeId').isUUID(),
  ], validate, matchCtrl.acceptRequest);
  matchRouter.post('/requests/:swipeId/decline', authenticate, [
    param('swipeId').isUUID(),
  ], validate, matchCtrl.declineRequest);
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
sessionRouter.post('/:id/proof', authenticate, [
  param('id').isUUID(),
  body('proofImageUrl').notEmpty().isURL().withMessage('Valid image URL required'),
], validate, sessCtrl.uploadProof);
sessionRouter.post('/:id/confirm', authenticate, [
  param('id').isUUID(),
], validate, sessCtrl.confirmSession);
sessionRouter.post('/:id/respond', authenticate, [
  param('id').isUUID(),
  body('action').isIn(['confirm', 'decline']),
], validate, sessCtrl.respondToInvite);

// ── /chat ─────────────────────────────────────────────────
const chatRouter = express.Router();
chatRouter.get('/', authenticate, chatCtrl.getChats);
chatRouter.get('/:chatId/messages', authenticate, [
  param('chatId').isUUID(),
], validate, chatCtrl.getMessages);
chatRouter.post('/:chatId/messages', authenticate, requireToken, [
  param('chatId').isUUID(),
  body('content').notEmpty().isLength({ max: 5000 }),
  body('type').optional().isIn(['text', 'image', 'session_invite', 'proof']),
], validate, chatCtrl.sendMessage);
chatRouter.patch('/:chatId/read', authenticate, [
  param('chatId').isUUID(),
], validate, chatCtrl.markRead);

// ── /notifications ────────────────────────────────────────
const notifRouter = express.Router();
notifRouter.get('/', authenticate, notifCtrl.getNotifications);
notifRouter.patch('/read-all', authenticate, notifCtrl.markAllRead);
notifRouter.patch('/:id/read', authenticate, [
  param('id').isUUID(),
], validate, notifCtrl.markRead);

// ── /subscriptions ────────────────────────────────────────
const subRouter = express.Router();
subRouter.get('/plans', subCtrl.getPlans);
subRouter.post('/order', authenticate, [
  body('planId').isUUID(),
], validate, subCtrl.createOrder);
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

const challengeLeaderboardCtrl = require('../controllers/challenge.controller');

// ── /global-leaderboard ───────────────────────────────────
const globalLeaderboardRouter = express.Router();
globalLeaderboardRouter.get('/', authenticate, challengeLeaderboardCtrl.getGlobalLeaderboard);

// ── /feed — 24hr global challenge feed ────────────────────
const feedRouter = express.Router();
feedRouter.get('/', authenticate, challengeLeaderboardCtrl.getGlobalFeed);
feedRouter.post('/', authenticate, [
  body('challengeId').isUUID(),
  body('stationTitle').notEmpty(),
], validate, challengeLeaderboardCtrl.postToFeed);

// ── Referral routes ──────────────────────────────────────
const referralCtrl  = require('../controllers/referral.controller');
const referralRouter = express.Router();
referralRouter.get('/my-code', authenticate, referralCtrl.getMyCode);
referralRouter.post('/apply',  authenticate, referralCtrl.applyCode);
referralRouter.get('/stats',   authenticate, referralCtrl.getStats);

// ── Brand Ads routes ─────────────────────────────────────
const brandAdsCtrl = require('../controllers/brand_ads.controller');
const brandAdsRouter = express.Router();

// User routes (Flutter)
brandAdsRouter.get('/active', authenticate, brandAdsCtrl.getActiveAd);
brandAdsRouter.post('/:id/impression', authenticate, brandAdsCtrl.trackImpression);
brandAdsRouter.post('/:id/click', authenticate, brandAdsCtrl.trackClick);

// Admin routes
brandAdsRouter.get('/', authenticate, brandAdsCtrl.getAll);
brandAdsRouter.post('/', authenticate, brandAdsCtrl.create);
brandAdsRouter.put('/:id', authenticate, brandAdsCtrl.update);
brandAdsRouter.delete('/:id', authenticate, brandAdsCtrl.remove);

// ── Verification routes ──────────────────────────────────
const verifCtrl = require('../controllers/verification.controller');
const verifRouter = express.Router();

// User routes
verifRouter.post('/submit', authenticate, verifCtrl.submit);
verifRouter.get('/status', authenticate, verifCtrl.getStatus);

// Admin routes
verifRouter.get('/', authenticate, verifCtrl.getQueue);
verifRouter.put('/:id/approve', authenticate, verifCtrl.approve);
verifRouter.put('/:id/reject', authenticate, verifCtrl.reject);

// ── Waitlist routes ──────────────────────────────────────
const waitlistCtrl = require('../controllers/waitlist.controller');
const waitlistRouter = express.Router();

// User routes
waitlistRouter.post('/join', authenticate, waitlistCtrl.join);

// Admin routes
waitlistRouter.get('/locations', authenticate, waitlistCtrl.getLocations);
waitlistRouter.post('/locations', authenticate, waitlistCtrl.addLocation);
waitlistRouter.put('/locations/:id', authenticate, waitlistCtrl.updateLocation);
waitlistRouter.post('/locations/:id/launch', authenticate, waitlistCtrl.launch);
waitlistRouter.get('/stats', authenticate, waitlistCtrl.getStats);
waitlistRouter.get('/export', authenticate, waitlistCtrl.exportCsv);

// ── Flash Streak routes ──────────────────────────────────
const flashCtrl = require('../controllers/flash_streak.controller');
const flashRouter = express.Router();
flashRouter.post('/send', authenticate, flashCtrl.recordFlashSent);
flashRouter.get('/streaks', authenticate, flashCtrl.getMyStreaks);
flashRouter.get('/streak/:buddyId', authenticate, flashCtrl.getPairStreak);

module.exports = {
  userRouter, matchRouter, sessionRouter, chatRouter,
  notifRouter, subRouter, tokensRouter, uploadRouter,
  challengeRouter, globalLeaderboardRouter, feedRouter,
  flashRouter, waitlistRouter, verifRouter, brandAdsRouter,
  referralRouter
};
