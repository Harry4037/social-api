// ─────────────────────────────────────────────────────────
//  challenge.routes.js  (V2)
// ─────────────────────────────────────────────────────────
'use strict';
const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/middleware');
const ctrl = require('../controllers/challenge.controller');

const r = express.Router();

r.get ('/',          authenticate, ctrl.getChallenges);
r.get ('/my',        authenticate, ctrl.getMyChallenges);
r.get ('/:id',       authenticate, validate, ctrl.getChallenge);
r.get ('/:id/feed',  authenticate, validate, ctrl.getChallengeFeed);
r.post('/:id/join',  authenticate, [
  // param('id').isUUID(),
  body('buddyId').optional().isUUID(),
], validate, ctrl.joinChallenge);

// Complete the current station (live photo or a session's proof)
r.post('/:id/proof', authenticate, [
  body('proofImageUrl').optional().custom(require('../utils/mediaUrl').mediaUrlValidator),
  body('sessionId').optional().isUUID(),
  body('stationId').optional().isUUID(),
], validate, ctrl.submitStationProof);

// Buddy joins a station completion (collab badge)
r.post('/:id/collab', authenticate, [
  body('stationCompletionId').isUUID(),
], validate, ctrl.addCollab);

module.exports = r;
