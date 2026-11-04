'use strict';
const router  = require('express').Router();
const ctrl    = require('../controllers/auth.controller');
const { body } = require('express-validator');
const { validate, authLimiter } = require('../middleware/middleware');
const { authenticate } = require('../middleware/auth');

// bcrypt only uses the first 72 BYTES — longer passwords were silently cut
const max72 = (v) => { if (Buffer.byteLength(String(v), 'utf8') > 72) throw new Error('Password is too long (max 72 characters)'); return true; };
const pwRules = [
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .custom(max72)
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

// Email verification (logged in)
router.post('/email/send-code', authenticate, ctrl.sendEmailCode);
router.post('/email/verify', authenticate, authLimiter, [
  body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Enter the 6-digit code'),
], validate, ctrl.verifyEmail);

// Forgot password (email OTP) — rate limited like login
// normalizeEmail() exactly like /register and /login — otherwise
// "Ravi.Kumar@gmail.com" (stored as "ravikumar@gmail.com") was never found
router.post('/forgot-password', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
], validate, ctrl.forgotPassword);
router.post('/verify-otp', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Enter the 6-digit code'),
], validate, ctrl.verifyOtp);
router.post('/reset-password', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric(),
  body('newPassword').isLength({ min: 8, max: 128 }).withMessage('Password must be at least 8 characters')
    .custom(max72)
    .matches(/[A-Z]/).withMessage('Must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Must contain at least one number'),
], validate, ctrl.resetPassword);

module.exports = router;
