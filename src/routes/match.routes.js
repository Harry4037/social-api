// match.routes.js
const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/middleware');
const auth  = require('../middleware/auth');
const match = require('../controllers/match.controller');

const router = express.Router();
router.use(auth);

router.post('/swipe', [
  body('targetId').isUUID(),
  body('action').optional().isIn(['like','skip','super_like']),
], validate, match.swipe);

router.get('/requests',                       match.getMatchRequests);
router.post('/requests/:swipeId/accept', [
  param('swipeId').isUUID(),
], validate, match.acceptRequest);
router.post('/requests/:swipeId/decline', [
  param('swipeId').isUUID(),
], validate, match.declineRequest);

module.exports = router;
