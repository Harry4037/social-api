'use strict';
// ─────────────────────────────────────────────────────────
//  verification.controller.js
//  Profile Verification — ID + Selfie
//  AI Proof Scanner — Hive Moderation API
// ─────────────────────────────────────────────────────────
const { v4: uuid } = require('uuid');
const axios         = require('axios');
const prisma        = require('../config/db');
const res_          = require('../utils/response');
const notifSvc      = require('../services/notification.service');

// ── AI Image Check (Hive API) ─────────────────────────────
const checkProofImage = async (imageUrl) => {
  try {
    const response = await axios.post(
      'https://api.thehive.ai/api/v2/task/sync',
      { url: imageUrl },
      {
        headers: {
          'Authorization': `token ${process.env.HIVE_API_KEY}`,
          'Content-Type':  'application/json',
        },
        timeout: 10000, // 10 second timeout
      }
    );

    const classes = response.data
        ?.status?.[0]
        ?.response
        ?.output?.[0]
        ?.classes || [];

    // AI generated check
    const aiGenerated = classes.find(c => c.class === 'ai_generated');
    if (aiGenerated?.score > 0.8) {
      return { valid: false, reason: 'AI generated image detected' };
    }

    // Stock photo check
    const stockPhoto = classes.find(c => c.class === 'stock_photo');
    if (stockPhoto?.score > 0.85) {
      return { valid: false, reason: 'Stock photo detected. Please upload a real photo.' };
    }

    // No face detected — optional check
    const noFace = classes.find(c => c.class === 'no_face');
    if (noFace?.score > 0.95) {
      return { valid: false, reason: 'No person detected in photo. Please upload a photo with yourself.' };
    }

    return { valid: true };
  } catch (e) {
    // API fail → allow upload (never block users due to API issue)
    console.error('[Hive] checkProofImage error:', e.message);
    return { valid: true };
  }
};

// ── USER: Submit verification request ─────────────────────
// POST /verification/submit
const submit = async (req, res, next) => {
  try {
    const userId        = req.user.id;
    const { type = 'id', docUrl, selfieUrl } = req.body;

    if (!docUrl) return res_.error(res, 'Document URL required', 400);
    if (!['id', 'selfie'].includes(type))
      return res_.error(res, 'Invalid type. Use id or selfie', 400);

    // Check if already pending/verified
    const existing = await prisma.verificationRequest.findFirst({
      where: {
        userId,
        type,
        status: { in: ['pending', 'verified'] },
      },
    });

    if (existing?.status === 'verified')
      return res_.error(res, 'Already verified', 400);
    if (existing?.status === 'pending')
      return res_.error(res, 'Verification already pending review', 400);

    // Create request
    const request = await prisma.verificationRequest.create({
      data: {
        id:        uuid(),
        userId,
        type,
        docUrl,
        selfieUrl: selfieUrl || null,
        status:    'pending',
      },
    });

    return res_.created(res, { request }, 'Verification submitted. We will review within 48 hours.');
  } catch(e) { next(e); }
};

// ── USER: Get my verification status ──────────────────────
// GET /verification/status
const getStatus = async (req, res, next) => {
  try {
    const userId   = req.user.id;
    const requests = await prisma.verificationRequest.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
    });

    const idVerif     = requests.find(r => r.type === 'id');
    const selfieVerif = requests.find(r => r.type === 'selfie');

    return res_.success(res, {
      id: {
        status:          idVerif?.status || 'not_submitted',
        rejectionReason: idVerif?.rejectionReason || null,
      },
      selfie: {
        status:          selfieVerif?.status || 'not_submitted',
        rejectionReason: selfieVerif?.rejectionReason || null,
      },
    });
  } catch(e) { next(e); }
};

// ── ADMIN: Get verification queue ─────────────────────────
// GET /admin/verifications
const getQueue = async (req, res, next) => {
  try {
    const { status = 'pending', type, page = 1, limit = 20 } = req.query;
    const skip  = (Number(page) - 1) * Number(limit);
    const where = { status };
    if (type) where.type = type;

    const [requests, total] = await Promise.all([
      prisma.verificationRequest.findMany({
        where,
        include: {
          user: {
            select: {
              id: true, firstName: true, lastName: true,
              email: true, avatarUrl: true, trustScore: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' }, // oldest first
        skip,
        take: Number(limit),
      }),
      prisma.verificationRequest.count({ where }),
    ]);

    return res_.paginated(res, requests, { page, limit, total });
  } catch(e) { next(e); }
};

// ── ADMIN: Approve verification ───────────────────────────
// PUT /admin/verifications/:id/approve
const approve = async (req, res, next) => {
  try {
    const request = await prisma.verificationRequest.findUnique({
      where: { id: req.params.id },
    });
    if (!request) return res_.error(res, 'Request not found', 404);
    if (request.status !== 'pending')
      return res_.error(res, 'Already reviewed', 400);

    // Update verification request
    await prisma.verificationRequest.update({
      where: { id: request.id },
      data: {
        status:     'verified',
        reviewedBy: req.admin?.id || null,
        updatedAt:  new Date(),
      },
    });

    // Update user fields based on type
    const userUpdate = {};
    if (request.type === 'id') {
      userUpdate.idVerified  = true;
      userUpdate.trustScore  = { increment: 10 }; // Trust Score +10
    }
    if (request.type === 'selfie') {
      userUpdate.photoVerified = true;
    }

    await prisma.user.update({
      where: { id: request.userId },
      data:  userUpdate,
    });

    // Notify user
    await notifSvc.send(request.userId, 'id_verified', {});

    return res_.success(res, null, 'Verification approved');
  } catch(e) { next(e); }
};

// ── ADMIN: Reject verification ────────────────────────────
// PUT /admin/verifications/:id/reject
const reject = async (req, res, next) => {
  try {
    const { reason = 'Document not clear. Please resubmit.' } = req.body;

    const request = await prisma.verificationRequest.findUnique({
      where: { id: req.params.id },
    });
    if (!request) return res_.error(res, 'Request not found', 404);
    if (request.status !== 'pending')
      return res_.error(res, 'Already reviewed', 400);

    await prisma.verificationRequest.update({
      where: { id: request.id },
      data: {
        status:          'rejected',
        rejectionReason: reason,
        reviewedBy:      req.admin?.id || null,
        updatedAt:       new Date(),
      },
    });

    // Notify user — they can resubmit
    await notifSvc.send(request.userId, 'id_verified', {});

    return res_.success(res, null, 'Verification rejected');
  } catch(e) { next(e); }
};

module.exports = {
  submit,
  getStatus,
  getQueue,
  approve,
  reject,
  checkProofImage, // exported for use in upload/session controllers
};
