'use strict';
const router  = require('express').Router();
const ctrl    = require('../controllers/auth.controller');
const { body } = require('express-validator');
const { validate, authLimiter } = require('../middleware/middleware');
const { authenticate } = require('../middleware/auth');

const pwRules = [
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Must contain at least one number'),
];

router.post('/register', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('firstName').trim().notEmpty().withMessage('First name required'),
  body('lastName').trim().notEmpty().withMessage('Last name required'),
  ...pwRules,
], validate, ctrl.register);

router.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], validate, ctrl.login);

router.post('/refresh', [
  body('refreshToken').notEmpty().withMessage('refreshToken required'),
], validate, ctrl.refresh);

router.post('/logout',  authenticate, ctrl.logout);
router.get ('/me',      authenticate, ctrl.me);

module.exports = router;
