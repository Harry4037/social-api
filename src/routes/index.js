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
const { mediaUrlValidator, isOwnUpload } = require('../utils/mediaUrl');
// express-validator check: URL must be a file THIS user uploaded
const ownUploadValidator = async (value, { req }) => {
  if (!(await isOwnUpload(req.user.id, value))) throw new Error('Image must be uploaded through the app');
  return true;
};

// ── /users ────────────────────────────────────────────────
const userRouter = express.Router();
userRouter.put('/me', authenticate, [
  body('firstName').optional().trim().notEmpty(),
  body('lastName').optional().trim().notEmpty(),
  body('username').optional().trim().isLength({ min: 3, max: 30 })
    .matches(/^[a-z0-9_]+$/i).withMessage('Username: letters, numbers, underscores only'),
  body('bio').optional().trim().isLength({ max: 500 }),
  body('city').optional().trim(),
  body('latitude').optional().isFloat({ min: -90, max: 90 }),
  body('longitude').optional().isFloat({ min: -180, max: 180 }),
  body('avatarUrl').optional({ nullable: true }).custom(ownUploadValidator),
  // bail() first: a 50 000-item array must be rejected without checking each item
  body('activities').optional().isArray({ max: 20 }).withMessage('Up to 20 activities').bail()
    .custom(a => a.every(x => typeof x === 'string' && x.length <= 40)).withMessage('Invalid activity'),
  body('goals').optional().isArray({ max: 20 }).withMessage('Up to 20 goals').bail()
    .custom(a => a.every(x => typeof x === 'string' && x.length <= 60)).withMessage('Invalid goal'),
  body(['city', 'username']).optional({ nullable: true }).isLength({ max: 60 }),
  body(['firstName', 'lastName']).optional().isLength({ max: 50 }),
  body('searchRadius').optional().isInt({ min: 1, max: 500 }),
  body('profileVisibility').optional().isIn(['public', 'buddies', 'hidden']),
  body(['shareLocation', 'showOnline', 'walkthroughSeen']).optional().isBoolean(),
  body('primaryGym').optional({ nullable: true }).trim().isLength({ max: 120 }),
  body('instagramHandle').optional({ nullable: true }).trim().isLength({ max: 60 }),
  body('phone').optional({ nullable: true }).trim().isLength({ max: 20 }),
  body(['gender', 'primaryActivity', 'experienceLevel', 'country'])
    .optional({ nullable: true }).isString().isLength({ max: 40 }),
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
    const url = (req.body.url || '').toString().trim();
    // Must be MY upload (someone else's photo = catfishing)
    if (!(await isOwnUpload(req.user.id, url))) {
      return res.status(422).json({ success: false, message: 'Photo must be uploaded through the app' });
    }
    const count = await prisma.userPhoto.count({ where: { userId: req.user.id } });
    if (count >= 5)
      return res.status(400).json({ success: false, message: 'Maximum 5 photos allowed' });
    const photo = await prisma.userPhoto.create({
      data: {
        id: require('uuid').v4(),
        userId: req.user.id,
        url,
        order: count,
      },
    });
    // First photo becomes the profile picture if the user has none yet
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { avatarUrl: true } });
    if (!me?.avatarUrl || count === 0) {
      await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: url } });
    }
    return res.status(201).json({ success: true, data: { photo } });
  } catch (e) { next(e); }
});

// Re-number photo order 0..n-1 and keep avatarUrl = first photo
const _syncPhotos = async (userId) => {
  const photos = await prisma.userPhoto.findMany({ where: { userId }, orderBy: { order: 'asc' } });
  await Promise.all(photos.map((p, i) => p.order === i
    ? null
    : prisma.userPhoto.update({ where: { id: p.id }, data: { order: i } })));
  if (photos.length) {
    await prisma.user.update({ where: { id: userId }, data: { avatarUrl: photos[0].url } });
  }
  return photos.map((p, i) => ({ ...p, order: i }));
};

userRouter.delete('/me/photos/:photoId', authenticate, async (req, res, next) => {
  try {
    const photo = await prisma.userPhoto.findFirst({
      where: { id: req.params.photoId, userId: req.user.id },
    });
    if (!photo) return res.json({ success: true, message: 'Photo deleted' });
    await prisma.userPhoto.delete({ where: { id: photo.id } });
    const remaining = await _syncPhotos(req.user.id);
    // Deleted the profile picture and no photos left → clear it
    if (!remaining.length) {
      const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { avatarUrl: true } });
      if (me?.avatarUrl === photo.url) {
        await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: null } });
      }
    }
    return res.json({ success: true, message: 'Photo deleted', data: { photos: remaining } });
  } catch (e) { next(e); }
});

// PUT /users/me/photos/:photoId/main — make this the main (profile) photo
userRouter.put('/me/photos/:photoId/main', authenticate, async (req, res, next) => {
  try {
    const photos = await prisma.userPhoto.findMany({
      where: { userId: req.user.id }, orderBy: { order: 'asc' },
    });
    const target = photos.find(p => p.id === req.params.photoId);
    if (!target) return res.status(404).json({ success: false, message: 'Photo not found' });
    const ordered = [target, ...photos.filter(p => p.id !== target.id)];
    await prisma.$transaction(ordered.map((p, i) =>
      prisma.userPhoto.update({ where: { id: p.id }, data: { order: i } })));
    await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: target.url } });
    return res.json({
      success: true,
      message: 'Main photo updated',
      data: { avatarUrl: target.url, photos: ordered.map((p, i) => ({ ...p, order: i })) },
    });
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
  body('activity').isString().trim().notEmpty().withMessage('Activity is required')
    .isLength({ max: 40 }).withMessage('Activity name is too long'),
  body('challengeId').optional({ nullable: true }).isUUID(),
  body('scheduledAt').isISO8601().withMessage('scheduledAt must be ISO 8601'),
  body('buddyId').optional().isUUID(),
  body('buddyIds').optional().isArray({ max: 9 }).withMessage('buddyIds must be a list (max 9)').bail()
    .custom(a => a.every(x => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x))).withMessage('Invalid buddy id'),
  body('durationMins').optional().isIn([45, 60, 90, 120, '45', '60', '90', '120']),
  body('gymName').optional({ nullable: true }).trim().isLength({ max: 120 }),
  body('notes').optional({ nullable: true }).isString().isLength({ max: 500 }),
], validate, sessCtrl.scheduleSession);
sessionRouter.get('/my', authenticate, sessCtrl.getMySessions);
sessionRouter.get('/pending-confirm', authenticate, sessCtrl.getPendingConfirmations);
sessionRouter.post('/:id/proof', authenticate, [
  param('id').isUUID(),
  body('proofImageUrl').custom(mediaUrlValidator),
], validate, sessCtrl.uploadProof);
sessionRouter.post('/:id/confirm', authenticate, [param('id').isUUID()], validate, sessCtrl.confirmSession);
sessionRouter.post('/:id/on-my-way', authenticate, [param('id').isUUID()], validate, sessCtrl.onMyWay);
sessionRouter.post('/:id/respond', authenticate, [
  param('id').isUUID(),
  body('action').isIn(['confirm', 'decline']),
], validate, sessCtrl.respondToInvite);

// ── /chat ─────────────────────────────────────────────────
const chatRouter = express.Router();
chatRouter.get('/', authenticate, chatCtrl.getChats);
// GET /chat/with/:userId — my 1:1 chat with a buddy (profile "Message" button)
chatRouter.get('/with/:userId', authenticate, [param('userId').isUUID()], validate, chatCtrl.chatWith);
chatRouter.get('/:chatId/messages', authenticate, [param('chatId').isUUID()], validate, chatCtrl.getMessages);
chatRouter.post('/:chatId/messages', authenticate, [
  param('chatId').isUUID(),
  body('content').notEmpty().isLength({ max: 5000 }),
  // proof / session_invite / system cards are created by the SERVER only
  body('type').optional().isIn(['text', 'image']).withMessage('Unsupported message type'),
  body('metadata').not().exists().withMessage('metadata is not allowed'),
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
subRouter.post('/webhook', subCtrl.webhook); // Razorpay → server (signature checked)
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
uploadRouter.post('/', authenticate, require('../middleware/middleware').uploadLimiter, upload.single('file'), upCtrl.uploadFile);

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
  body('stationTitle').optional().isString().isLength({ max: 120 }),
  body('caption').optional({ nullable: true }).isString().isLength({ max: 300 }),
  body('sessionId').optional().isUUID(),
  body('stationCompletionId').optional().isUUID(),
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
verifRouter.post('/submit',  authenticate, [
  body('docUrl').custom(ownUploadValidator),
  body('selfieUrl').optional({ nullable: true }).custom(ownUploadValidator),
], validate, verifCtrl.submit);
verifRouter.get('/status',   authenticate, verifCtrl.getStatus);

// ── /waitlist (user-facing only) ─────────────────────────
// Admin management is in admin.routes.js under /admin/waitlist
const waitlistRouter = express.Router();
waitlistRouter.post('/join', authenticate, waitlistCtrl.join);

// ── /flash ────────────────────────────────────────────────
const flashRouter = express.Router();
flashRouter.post('/send',        authenticate, [body('buddyId').isUUID()], validate, flashCtrl.recordFlashSent);
flashRouter.get('/streaks',      authenticate, flashCtrl.getMyStreaks);
flashRouter.get('/streak/:buddyId', authenticate, [param('buddyId').isUUID()], validate, flashCtrl.getPairStreak);

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
  body('placeId').isLength({ max: 191 }),
  body('gymName').isLength({ max: 120 }),
  body('address').optional({ nullable: true }).isString().isLength({ max: 255 }),
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
