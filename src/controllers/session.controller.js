'use strict';
const { v4: uuid } = require('uuid');
const prisma     = require('../config/db');
const res_       = require('../utils/response');
const notifSvc   = require('../services/notification.service');
const xpSvc      = require('../services/xp.service');

const SESSION_FIELDS = {
  include: { user: { select: { firstName: true, lastName: true } },
             buddy: { select: { firstName: true, lastName: true } } },
};

const formatSession = (s) => ({
  id:              s.id,
  userId:          s.userId,
  buddyId:         s.buddyId,
  buddyName:       s.buddy ? `${s.buddy.firstName} ${s.buddy.lastName}` : null,
  activity:        s.activity,
  gymName:         s.gymName,
  scheduledAt:     s.scheduledAt,
  status:          s.status,
  proofImageUrl:   s.proofImageUrl,
  proofVideoUrl:   s.proofVideoUrl,
  proofUploadedAt: s.proofUploadedAt,
  xpEarned:        s.xpEarned,
  tokensDeducted:  s.tokensDeducted,
  notes:           s.notes,
  createdAt:       s.createdAt,
});

// POST /sessions
const scheduleSession = async (req, res, next) => {
  try {
    const { buddyId, activity, scheduledAt, gymName, notes } = req.body;

    const dt = new Date(scheduledAt);
    if (isNaN(dt) || dt < new Date()) {
      return res_.error(res, 'scheduledAt must be a future date', 422);
    }

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

    // Notify buddy
    if (buddyId) {
      const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } });
      await notifSvc.notifySessionScheduled(buddyId, `${me.firstName} ${me.lastName}`, session.id);
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

    const xpAmount = 50;
    const updated  = await prisma.workoutSession.update({
      where: { id: session.id },
      data: {
        proofImageUrl,
        proofUploadedAt: new Date(),
        status:          'completed',
        xpEarned:        xpAmount,
      },
      ...SESSION_FIELDS,
    });

    await xpSvc.awardXp(req.user.id, 'session_uploaded');

    return res_.success(res, formatSession(updated), 'Proof uploaded — session completed!');
  } catch (e) { next(e); }
};

module.exports = { scheduleSession, getMySessions, uploadProof };
