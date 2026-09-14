'use strict';
const router = require('express').Router();
const { body, param } = require('express-validator');
const { validate } = require('../../middleware/middleware');
const { adminAuth, requireRole, audit } = require('../middleware/adminAuth');

const authCtrl = require('../controllers/adminAuth.controller');
const dashCtrl = require('../controllers/dashboard.controller');
const usersCtrl = require('../controllers/adminUsers.controller');
const contentCtrl = require('../controllers/adminContent.controller');
const cms = require('../controllers/cms.controller');

// ── Public ────────────────────────────────────────────────
router.post('/auth/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], validate, authCtrl.login);

// ── Protected ─────────────────────────────────────────────
router.use(adminAuth);

// Auth
router.get('/auth/me', authCtrl.me);
router.post('/auth/change-password', authCtrl.changePassword);

// Dashboard
router.get('/dashboard/stats', dashCtrl.getStats);
router.get('/dashboard/recent-activity', dashCtrl.getRecentActivity);

// ── Users (ADMIN+) ────────────────────────────────────────
router.get('/users', requireRole('SUPPORT'), usersCtrl.listUsers);
router.get('/users/:id', requireRole('SUPPORT'), [param('id').isUUID()], validate, usersCtrl.getUser);
router.patch('/users/:id', requireRole('ADMIN'), [param('id').isUUID()], validate, audit('user.update', 'user'), usersCtrl.updateUser);
router.post('/users/:id/ban', requireRole('MODERATOR'), [param('id').isUUID()], validate, audit('user.ban', 'user'), usersCtrl.banUser);
router.post('/users/:id/unban', requireRole('MODERATOR'), [param('id').isUUID()], validate, audit('user.unban', 'user'), usersCtrl.unbanUser);
router.delete('/users/:id', requireRole('ADMIN'), [param('id').isUUID()], validate, audit('user.delete', 'user'), usersCtrl.deleteUser);
router.post('/users/:id/grant-tokens', requireRole('ADMIN'), [param('id').isUUID(), body('amount').optional().isInt({ min: 1, max: 1000 })], validate, audit('user.grantTokens', 'user'), usersCtrl.grantTokens);

// ── Sessions ──────────────────────────────────────────────
router.get('/sessions', requireRole('SUPPORT'), contentCtrl.listSessions);
router.patch('/sessions/:id', requireRole('MODERATOR'), [param('id').isUUID()], validate, audit('session.update', 'session'), contentCtrl.updateSession);

// ── Matches ───────────────────────────────────────────────
router.get('/matches', requireRole('SUPPORT'), contentCtrl.listMatches);
router.delete('/matches/:id', requireRole('MODERATOR'), [param('id').isUUID()], validate, audit('match.delete', 'match'), contentCtrl.deleteMatch);

// ── Orders / Revenue ──────────────────────────────────────
router.get('/orders', requireRole('ANALYST'), contentCtrl.listOrders);

// ── Subscription Plans ────────────────────────────────────
router.get('/plans', requireRole('ANALYST'), contentCtrl.listPlans);
router.patch('/plans/:id', requireRole('ADMIN'), [param('id').isUUID()], validate, audit('plan.update', 'plan'), contentCtrl.updatePlan);

// ── Notifications ─────────────────────────────────────────
router.post('/notifications/broadcast', requireRole('ADMIN'),
  [body('title').notEmpty(), body('message').notEmpty()], validate,
  audit('notification.broadcast', 'notification'), contentCtrl.broadcastNotification);

// ── Audit Logs ────────────────────────────────────────────
router.get('/audit-logs', requireRole('ADMIN'), contentCtrl.listAuditLogs);

// ── Admin accounts (SUPER_ADMIN only) ─────────────────────
router.get('/admins', requireRole('SUPER_ADMIN'), usersCtrl.listAdmins);
router.post('/admins', requireRole('SUPER_ADMIN'), [body('email').isEmail(), body('password').isLength({ min: 8 }), body('firstName').notEmpty(), body('lastName').notEmpty()], validate, audit('admin.create', 'admin'), usersCtrl.createAdmin);
router.patch('/admins/:id', requireRole('SUPER_ADMIN'), [param('id').isUUID()], validate, audit('admin.update', 'admin'), usersCtrl.updateAdmin);


// ── V2 Challenge management ────────────────────────────────
const challengeAdminCtrl = require('../controllers/adminChallenge.controller');

router.post('/challenges/bulk', requireRole('ADMIN'), challengeAdminCtrl.bulkCreate);
router.get('/challenges', requireRole('ADMIN'), challengeAdminCtrl.list);
router.post('/challenges', requireRole('ADMIN'), [
  body('title').notEmpty().trim(),
  body('type').isIn(['solo', 'duel', 'pack']),
  body('tier').isInt({ min: 1, max: 4 }),
  body('startAt').isISO8601(),
  body('endAt').isISO8601(),
  body('xpPool').isInt({ min: 1 }),
  body('stations').isArray({ min: 1 }),
], validate, challengeAdminCtrl.create);
router.patch('/challenges/:id', requireRole('ADMIN'), [param('id').isUUID()], validate, challengeAdminCtrl.update);
router.delete('/challenges/:id', requireRole('ADMIN'), [param('id').isUUID()], validate, challengeAdminCtrl.remove);
router.get('/challenges/:id/entries', requireRole('ADMIN'), [param('id').isUUID()], validate, challengeAdminCtrl.getEntries);


router.get('/blog', requireRole('ADMIN'), cms.getArticles);
router.get('/blog/:id', requireRole('ADMIN'), cms.getArticle);
router.post('/blog', requireRole('ADMIN'), [
  body('title').trim().notEmpty(),
  body('content').notEmpty(),
  body('category').isIn(['member_story', 'challenge', 'fitness_industry', 'app_update', 'upcoming']),
  body('status').optional().isIn(['draft', 'published']),
], validate, cms.createArticle);
router.put('/blog/:id', requireRole('ADMIN'), [
  param('id').isUUID(),
], validate, cms.updateArticle);
router.delete('/blog/:id', requireRole('ADMIN'), [
  param('id').isUUID(),
], validate, cms.deleteArticle);

// ── SEO ───────────────────────────────────────────────────
router.get('/seo', requireRole('ADMIN'), cms.getSeoPages);
router.put('/seo/:pageKey', requireRole('ADMIN'), cms.updateSeoPage);
router.post('/seo/:pageKey/faq', requireRole('ADMIN'), [
  body('question').notEmpty(),
  body('answer').notEmpty(),
], validate, cms.addFaq);
router.put('/seo/faq/:faqId', requireRole('ADMIN'), cms.updateFaq);
router.delete('/seo/faq/:faqId', requireRole('ADMIN'), cms.deleteFaq);

// ── WEBSITE CONTENT ───────────────────────────────────────
router.get('/content', requireRole('ADMIN'), cms.getContent);
router.put('/content', requireRole('ADMIN'), [
  body('updates').isObject(),
], validate, cms.updateContent);

// ── SOCIAL LINKS ──────────────────────────────────────────
router.get('/social', requireRole('ADMIN'), cms.getSocialLinks);
router.put('/social', requireRole('ADMIN'), [
  body('links').isArray(),
], validate, cms.updateSocialLinks);

module.exports = router;