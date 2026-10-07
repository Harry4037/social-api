'use strict';
// ─────────────────────────────────────────────────────────
//  influencer.routes.js — COMPLETE FILE
//  src/routes/influencer.routes.js
//
//  Handles both user-facing + admin influencer routes
//  Mounted at: /api/v1/influencer
// ─────────────────────────────────────────────────────────
const express  = require('express');
const { body, param, query } = require('express-validator');
const router   = express.Router();

const { authenticate, requireRole } = require('../middleware/auth');
const validate   = require('../middleware/validate');
const audit      = require('../middleware/audit');
const inflCtrl   = require('../controllers/influencer.controller');

// ── USER ROUTES ───────────────────────────────────────────

// Apply as influencer (Elite users only — checked in controller)
router.post('/apply', authenticate, [
  body('instagramHandle').notEmpty().trim(),
  body('claimedFollowers').isInt({ min: 1000 }),
  body('bio').optional().trim(),
], validate, inflCtrl.apply);

// Get my influencer status
router.get('/my-status', authenticate, inflCtrl.getMyStatus);

// Verify Instagram code (user places code in bio, then calls this)
router.post('/verify-code', authenticate, inflCtrl.verifyCode);

// List verified influencers (for discover — all users)
router.get('/list', authenticate, inflCtrl.listInfluencers);

// Get specific influencer profile
router.get('/:influencerId', authenticate, [
  param('influencerId').isUUID(),
], validate, inflCtrl.getInfluencerProfile);

// Book session with influencer (Elite users only)
router.post('/:influencerId/book', authenticate, [
  param('influencerId').isUUID(),
], validate, inflCtrl.bookSession);

// ── ADMIN ROUTES ──────────────────────────────────────────
// These are called by InfluencerPage.jsx in admin panel
// Auth handled by adminAuth middleware via /admin prefix
// BUT since this router is mounted at /influencer
// we need to add auth here too

const { adminAuth } = require('../middleware/auth');

// GET /influencer/admin/applications?status=pending
router.get('/admin/applications',
  adminAuth,
  requireRole('SUPER_ADMIN'),
  [query('status').optional().isIn(['pending', 'code_added', 'approved', 'rejected'])],
  validate,
  inflCtrl.getApplications
);

// GET /influencer/admin/list — verified influencers
router.get('/admin/list',
  adminAuth,
  requireRole('SUPER_ADMIN'),
  inflCtrl.getVerifiedInfluencers
);

// PUT /influencer/admin/:id/approve
router.put('/admin/:id/approve',
  adminAuth,
  requireRole('SUPER_ADMIN'),
  [
    param('id').isUUID(),
    body('verifiedFollowers').isInt({ min: 0 }),
  ],
  validate,
  audit('influencer.approve', 'user'),
  inflCtrl.approve
);

// PUT /influencer/admin/:id/reject
router.put('/admin/:id/reject',
  adminAuth,
  requireRole('SUPER_ADMIN'),
  [param('id').isUUID()],
  validate,
  audit('influencer.reject', 'user'),
  inflCtrl.reject
);

// PUT /influencer/admin/:id/revoke
router.put('/admin/:id/revoke',
  adminAuth,
  requireRole('SUPER_ADMIN'),
  [param('id').isUUID()],
  validate,
  audit('influencer.revoke', 'user'),
  inflCtrl.revoke
);

module.exports = router;
