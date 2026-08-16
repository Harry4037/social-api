// ─────────────────────────────────────────────────────────
//  strike.routes.js — Strike 2 (Buddy Strike) routes
//  Mount: app.use('/api/strikes', strikeRouter)
// ─────────────────────────────────────────────────────────
const express = require('express');
const { body, param } = require('express-validator');
const { validate }    = require('../middleware/middleware');
// const auth            = require('../middleware/auth');
const strike          = require('../controllers/strike.controller');

const router = express.Router();

// All routes require auth
// router.use(auth);

// Send Strike 2
router.post('/', [
  body('matchId').isUUID(),
  body('imageUrl').isURL(),
  body('caption').optional().isString().isLength({ max: 150 }),
], validate, strike.sendStrike);

// View Strike 2 (one-time)
router.post('/:id/view', [
  param('id').isUUID(),
], validate, strike.viewStrike);

// React to Strike 2
router.post('/:id/react', [
  param('id').isUUID(),
  body('emoji').notEmpty(),
], validate, strike.reactToStrike);

// Get my pending strikes
router.get('/pending', strike.getPendingStrikes);

// Get streak for a match
router.get('/streak/:matchId', [
  param('matchId').isUUID(),
], validate, strike.getStreak);

module.exports = router;
