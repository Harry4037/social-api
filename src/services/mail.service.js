'use strict';
// ─────────────────────────────────────────────────────────
//  mail.service.js — transactional email (password reset OTP)
//
//  .env:
//    SMTP_HOST=smtp.gmail.com   (or SES / Zoho / Mailgun SMTP)
//    SMTP_PORT=587
//    SMTP_USER=...
//    SMTP_PASS=...
//    MAIL_FROM="Seshlly <no-reply@seshlly.com>"
//
//  Without SMTP_HOST the email is NOT sent — the content is written to
//  the server log instead (handy for local testing, never in production).
// ─────────────────────────────────────────────────────────
const logger = require('../config/logger');

let transporter = null;
const getTransporter = () => {
  if (transporter || !process.env.SMTP_HOST) return transporter;
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
};

const sendMail = async ({ to, subject, text, html }) => {
  const t = getTransporter();
  if (!t) {
    logger.warn(`[mail] SMTP not configured — email to ${to} not sent. Subject: ${subject} | ${text}`);
    return { sent: false };
  }
  await t.sendMail({
    from: process.env.MAIL_FROM || 'Seshlly <no-reply@seshlly.com>',
    to, subject, text, html,
  });
  return { sent: true };
};

const sendPasswordResetOtp = (to, firstName, otp) => sendMail({
  to,
  subject: `${otp} is your Seshlly password reset code`,
  text: `Hi ${firstName || 'there'},\n\nYour Seshlly password reset code is ${otp}.\n` +
        `It expires in 10 minutes. If you didn't request this, you can ignore this email.\n\n— Team Seshlly`,
  html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px">
    <h2 style="margin:0 0 12px">Reset your password</h2>
    <p>Hi ${firstName || 'there'},</p>
    <p>Your Seshlly password reset code is:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${otp}</p>
    <p style="color:#666">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    <p style="color:#999;font-size:12px">— Team Seshlly</p>
  </div>`,
});

const sendEmailVerificationCode = (to, firstName, otp) => sendMail({
  to,
  subject: `${otp} is your Seshlly verification code`,
  text: `Hi ${firstName || 'there'},\n\nWelcome to Seshlly! Your email verification code is ${otp}.\n` +
        `It expires in 30 minutes.\n\n— Team Seshlly`,
  html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px">
    <h2 style="margin:0 0 12px">Verify your email</h2>
    <p>Hi ${firstName || 'there'}, welcome to Seshlly! 💪</p>
    <p>Your verification code is:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${otp}</p>
    <p style="color:#666">This code expires in 30 minutes.</p>
  </div>`,
});

module.exports = { sendMail, sendPasswordResetOtp, sendEmailVerificationCode };
