'use strict';
const { v4: uuid } = require('uuid');
const prisma     = require('../config/db');
const res_       = require('../utils/response');
const notifSvc   = require('../services/notification.service');
const xpSvc      = require('../services/xp.service');

const SESSION_FIELDS = {
  include: {
    user:      { select: { firstName: true, lastName: true } },
    buddy:     { select: { firstName: true, lastName: true } },
    challenge: { select: { id: true, title: true } },
  },
};

const formatSession = (s) => ({
  id:                  s.id,
  userId:              s.userId,
  buddyId:             s.buddyId,
  buddyName:           s.buddy ? `${s.buddy.firstName} ${s.buddy.lastName}` : null,
  activity:            s.activity,
  gymName:             s.gymName,
  scheduledAt:         s.scheduledAt,
  status:              s.status,
  proofImageUrl:       s.proofImageUrl,
  proofVideoUrl:       s.proofVideoUrl,
  proofUploadedAt:     s.proofUploadedAt,
  xpEarned:            s.xpEarned,
  tokensDeducted:      s.tokensDeducted,
  notes:               s.notes,
  challengeId:         s.challengeId         ?? null,
  challengeTitle:      s.challenge?.title    ?? null,
  challengeStationNum: s.challengeStationNum ?? null,
  createdAt:           s.createdAt,
});

// POST /sessions
const scheduleSession = async (req, res, next) => {
  try {
    const { buddyId, activity, scheduledAt, gymName, notes } = req.body;

    const dt = new Date(scheduledAt);
    if (isNaN(dt) || dt < new Date()) {
      return res_.error(res, 'scheduledAt must be a future date', 422);
    }

    // ── BUDDY SESSION — MUST have active match ────────────
    if (buddyId) {
      const match = await prisma.match.findFirst({
        where: {
          OR: [
            { userAId: req.user.id, userBId: buddyId, status: 'active' },
            { userAId: buddyId, userBId: req.user.id, status: 'active' },
          ],
        },
      });

      if (!match) {
        return res_.error(
          res,
          'You can only schedule sessions with your Seshlly buddies. Connect with someone first!',
          403
        );
      }

      const buddy = await prisma.user.findUnique({
        where:  { id: buddyId, status: 'ACTIVE', isBanned: false },
        select: { id: true, firstName: true },
      });
      if (!buddy) return res_.error(res, 'Buddy not found or inactive', 404);
    }

    // ── Create session (solo or buddy) ────────────────────
    const session = await prisma.workoutSession.create({
      data: {
        id:          uuid(),
        userId:      req.user.id,
        buddyId:     buddyId || null,
        activity,
        scheduledAt: dt,
        gymName:     gymName || null,
        notes:       notes   || null,
      },
      ...SESSION_FIELDS,
    });

    // ── Mirror session for buddy + notification ───────────
    if (buddyId) {
      await prisma.workoutSession.create({
        data: {
          id:          uuid(),
          userId:      buddyId,
          buddyId:     req.user.id,
          activity,
          scheduledAt: dt,
          gymName:     gymName || null,
          notes:       notes   || null,
        },
      });

      const me = await prisma.user.findUnique({
        where:  { id: req.user.id },
        select: { firstName: true, lastName: true },
      });
      await notifSvc.notifySessionScheduled(
        buddyId,
        `${me.firstName} ${me.lastName}`,
        session.id
      );
    }

    return res_.created(res, formatSession(session), 'Session scheduled');
  } catch (e) { next(e); }
};

// GET /sessions/my
const getMySessions = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const where = { userId: req.user.id, ...(status && { status }) };

    const [sessions, total] = await Promise.all([
      prisma.workoutSession.findMany({
        where,
        ...SESSION_FIELDS,
        orderBy: { scheduledAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.workoutSession.count({ where }),
    ]);

    return res_.paginated(res, sessions.map(formatSession), { page, limit, total });
  } catch (e) { next(e); }
};

// POST /sessions/:id/proof
const uploadProof = async (req, res, next) => {
  try {
    const session = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!session) return res_.error(res, 'Session not found', 404);
    if (session.status === 'completed') return res_.error(res, 'Proof already uploaded', 409);

    const { proofImageUrl } = req.body;
    if (!proofImageUrl) return res_.error(res, 'proofImageUrl is required', 422);

    // ── Option 1: Time window validation ─────────────────────────
    // Proof must be uploaded within 2 hours of each other for buddy sessions
    // For solo sessions, standard 8-hour window applies
    const now          = new Date();
    const sessionTime  = new Date(session.scheduledAt);
    const hoursElapsed = (now - sessionTime) / (1000 * 60 * 60);

    if (hoursElapsed > 8) {
      return res_.error(res, 'Proof window closed — must upload within 8 hours of session time', 422);
    }

    const xpAmount = 50;
    const updated  = await prisma.workoutSession.update({
      where: { id: session.id },
      data: {
        proofImageUrl,
        proofUploadedAt: new Date(),
        status:          session.buddyId ? 'proof_uploaded' : 'completed', // buddy session waits for buddy confirm
        xpEarned:        xpAmount,
      },
      ...SESSION_FIELDS,
    });

    await xpSvc.awardXp(req.user.id, 'session_uploaded');

    // If buddy session — notify buddy to confirm
    if (session.buddyId) {
      await notifSvc.notifyProofUploaded(session.buddyId, req.user.id, session.id);
      return res_.success(res, formatSession(updated), 'Proof uploaded — waiting for buddy confirmation');
    }

    return res_.success(res, formatSession(updated), 'Proof uploaded — session completed!');
  } catch (e) { next(e); }
};

// ── POST /sessions/:id/confirm ─────────────────────────────────
// Option 3: Buddy confirms "haan hum saath the"
const confirmSession = async (req, res, next) => {
  try {
    // Find the mirror session where this user is the buddy
    const session = await prisma.workoutSession.findFirst({
      where: {
        id:      req.params.id,
        buddyId: req.user.id,   // current user must be the buddy of this session
        status:  'proof_uploaded',
      },
    });
    if (!session) return res_.error(res, 'Session not found or not ready for confirmation', 404);

    // Check time window — buddy must confirm within 2 hours of original proof
    const proofTime    = new Date(session.proofUploadedAt);
    const hoursElapsed = (new Date() - proofTime) / (1000 * 60 * 60);
    if (hoursElapsed > 2) {
      return res_.error(res, 'Confirmation window closed — buddy must confirm within 2 hours of proof upload', 422);
    }

    // Mark original session as completed
    const updated = await prisma.workoutSession.update({
      where: { id: session.id },
      data:  { status: 'completed' },
      ...SESSION_FIELDS,
    });

    // Also mark the buddy's own mirror session as completed
    await prisma.workoutSession.updateMany({
      where: {
        userId:      req.user.id,
        buddyId:     session.userId,
        scheduledAt: session.scheduledAt,
        status:      { not: 'completed' },
      },
      data: { status: 'completed', xpEarned: 50 },
    });

    // Award XP to buddy for confirming
    await xpSvc.awardXp(req.user.id, 'session_uploaded');

    // Notify original user that buddy confirmed
    await notifSvc.notifySessionConfirmed(session.userId, req.user.id, session.id);

    return res_.success(res, formatSession(updated), 'Session confirmed — both of you earned XP!');
  } catch (e) { next(e); }
};

module.exports = { scheduleSession, getMySessions, uploadProof, confirmSession };
