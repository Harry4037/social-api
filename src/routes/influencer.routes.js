'use strict';
// ─────────────────────────────────────────────────────────
//  influencer.routes.js
//  Mounted at: /api/v1/influencer
// ─────────────────────────────────────────────────────────
const express  = require('express');
const { body, param, query } = require('express-validator');
const router   = express.Router();

const { authenticate }              = require('../middleware/auth');
const { adminAuth, requireRole, audit } = require('../admin/middleware/adminAuth');
const { validate }                  = require('../middleware/middleware');
const inf                           = require('../controllers/influencer.controller');

// ── USER ROUTES ───────────────────────────────────────────

// POST /api/v1/influencer/apply
router.post('/apply', authenticate, [
  body('instagramHandle').notEmpty().trim(),
  body('claimedFollowers').isInt({ min: 50000 }),
  body('bio').optional().trim(),
], validate, inf.apply);

// POST /api/v1/influencer/code-added  (user marks code placed in bio)
router.post('/code-added', authenticate, inf.markCodeAdded);

// GET  /api/v1/influencer/my-status
router.get('/my-status', authenticate, inf.getMyStatus);

// GET  /api/v1/influencer/list  (browse verified influencers — all auth'd users)
router.get('/list', authenticate, inf.discoverInfluencers);

// GET  /api/v1/influencer/:influencerId  (profile)
router.get('/:influencerId', authenticate, [
  param('influencerId').isUUID(),
], validate, inf.getInfluencerProfile);

// ── ADMIN ROUTES (SUPER_ADMIN only) ──────────────────────

// GET  /api/v1/influencer/admin/applications?status=code_added
router.get('/admin/applications',
  adminAuth, requireRole('SUPER_ADMIN'),
  [query('status').optional().isIn(['pending', 'code_added', 'approved', 'rejected'])],
  validate,
  inf.getApplications
);

// GET  /api/v1/influencer/admin/list
router.get('/admin/list',
  adminAuth, requireRole('SUPER_ADMIN'),
  inf.getVerifiedInfluencers
);

// PUT  /api/v1/influencer/admin/:id/approve
router.put('/admin/:id/approve',
  adminAuth, requireRole('SUPER_ADMIN'),
  [param('id').isUUID(), body('verifiedFollowers').isInt({ min: 0 })],
  validate,
  audit('influencer.approve', 'user'),
  inf.approveApplication
);

// PUT  /api/v1/influencer/admin/:id/reject
router.put('/admin/:id/reject',
  adminAuth, requireRole('SUPER_ADMIN'),
  [param('id').isUUID(), body('reason').optional().isString()],
  validate,
  audit('influencer.reject', 'user'),
  inf.rejectApplication
);

// PUT  /api/v1/influencer/admin/:id/revoke
router.put('/admin/:id/revoke',
  adminAuth, requireRole('SUPER_ADMIN'),
  [param('id').isUUID()],
  validate,
  audit('influencer.revoke', 'user'),
  inf.revokeInfluencer
);

module.exports = router;
