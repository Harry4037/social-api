// influencer.routes.js
const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/middleware');
const { authenticate } = require('../middleware/auth');
const inf  = require('../controllers/influencer.controller');

const router = express.Router();
router.use(authenticate);

// User routes
router.post('/apply', [
  body('instagramHandle').notEmpty().trim(),
  body('claimedFollowers').isInt({ min: 50000 }),
], validate, inf.apply);

router.post('/code-added', inf.markCodeAdded);
router.get('/status',      inf.getMyStatus);
router.get('/discover',    inf.discoverInfluencers);
router.get('/:id',         inf.getInfluencerProfile);

// Admin routes (super admin only)
router.get('/admin/applications',       inf.getApplications);
router.get('/admin/list',               inf.getVerifiedInfluencers);
router.put('/admin/:id/approve', [
  param('id').isUUID(),
], validate, inf.approveApplication);
router.put('/admin/:id/reject', [
  param('id').isUUID(),
  body('reason').optional().isString(),
], validate, inf.rejectApplication);
router.put('/admin/:id/revoke', [
  param('id').isUUID(),
], validate, inf.revokeInfluencer);

module.exports = router;
