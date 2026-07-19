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
r.get ('/:id',       authenticate, [param('id').isUUID()], validate, ctrl.getChallenge);
r.get ('/:id/feed',  authenticate, [param('id').isUUID()], validate, ctrl.getChallengeFeed);
r.post('/:id/join',  authenticate, [
  param('id').isUUID(),
  body('buddyId').optional().isUUID(),
], validate, ctrl.joinChallenge);

module.exports = r;
