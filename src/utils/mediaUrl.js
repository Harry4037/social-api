'use strict';
// ─────────────────────────────────────────────────────────
//  Only accept image/video URLs that came from OUR upload service.
//
//  Why: profile photos, avatars and workout proofs are shown to other
//  users. A URL from any other site could be a tracking pixel (leaks the
//  viewer's IP), something that changes after review, or — for proofs —
//  a photo downloaded from the internet instead of the live camera.
//
//  ALLOWED_MEDIA_HOSTS = comma-separated hostnames
//  (default: res.cloudinary.com — where /upload stores files)
// ─────────────────────────────────────────────────────────
const allowedHosts = () =>
  (process.env.ALLOWED_MEDIA_HOSTS || 'res.cloudinary.com')
    .split(',').map(h => h.trim().toLowerCase()).filter(Boolean);

const isAllowedMediaUrl = (value) => {
  if (typeof value !== 'string' || value.length > 500) return false; // = DB column size
  let u;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (!allowedHosts().includes(u.hostname.toLowerCase())) return false;
  // Our Cloudinary account only (anyone can create a free Cloudinary account)
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (cloud && u.hostname.toLowerCase() === 'res.cloudinary.com' &&
      !u.pathname.startsWith(`/${cloud}/`)) return false;
  return true;
};

/**
 * Was this file uploaded by THIS user through POST /upload?
 * (Every upload is recorded in the `uploads` table.) Use it for anything
 * that earns XP or is shown as "theirs": proofs, photos, avatar, ID docs.
 */
const findOwnUpload = async (userId, url, { maxAgeHours = null, after = null } = {}) => {
  if (!isAllowedMediaUrl(url)) return null;
  const prisma = require('../config/db');
  const since = [
    maxAgeHours ? new Date(Date.now() - maxAgeHours * 3600e3) : null,
    after ? new Date(after) : null,
  ].filter(Boolean).sort((a, b) => b - a)[0];
  return prisma.upload.findFirst({
    where: { userId, url, ...(since ? { createdAt: { gte: since } } : {}) },
    select: { id: true, createdAt: true },
  });
};
const isOwnUpload = async (...args) => !!(await findOwnUpload(...args));

/** express-validator custom check */
const mediaUrlValidator = (value) => {
  if (!isAllowedMediaUrl(value)) throw new Error('Image must be uploaded through the app');
  return true;
};

module.exports = { isAllowedMediaUrl, isOwnUpload, findOwnUpload, mediaUrlValidator, allowedHosts };
