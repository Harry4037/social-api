// ─────────────────────────────────────────────────────────
//  session.controller.js
//  POST   /sessions          → scheduleSession
//  GET    /sessions/my       → getMySessions
//  POST   /sessions/:id/proof → uploadProof
//  POST   /sessions/:id/confirm → confirmSession
//  POST   /sessions/:id/respond → respondToInvite (confirm/decline)
//  CRON   markIncomplete     → called by scheduler
// ─────────────────────────────────────────────────────────
const { PrismaClient } = require('@prisma/client');
const { v4: uuid }     = require('uuid');
const prisma           = new PrismaClient();
const res_             = require('../utils/response');
const notifSvc         = require('../services/notification.service');
const xpCtrl           = require('./xp.controller');

// ── Session include fields ─────────────────────────────────
const SESSION_INCLUDE = {
  include: {
    user:         { select: { id:true, firstName:true, lastName:true, avatarUrl:true } },
    buddy:        { select: { id:true, firstName:true, lastName:true, avatarUrl:true } },
    challenge:    { select: { id:true, title:true, activityTag:true } },
    participants: {
      include: {
        user: { select: { id:true, firstName:true, lastName:true, avatarUrl:true } },
      },
    },
  },
};

const formatSession = (s, currentUserId = null) => ({
  id:               s.id,
  userId:           s.userId,
  buddyId:          s.buddyId,
  buddyName:        s.buddy
      ? `${s.buddy.firstName} ${s.buddy.lastName}` : null,
  buddyAvatar:      s.buddy?.avatarUrl ?? null,
  activity:         s.activity,
  gymName:          s.gymName,
  scheduledAt:      s.scheduledAt,
  durationMins:     s.durationMins,
  endTime:          s.endTime,
  // Session status: scheduled | completed | missed
  status:           s.status,
  // Invite status from SessionParticipant: pending | confirmed | declined
  inviteStatus:     currentUserId
      ? (s.participants?.find(p => p.userId === currentUserId)?.status ?? null)
      : null,
  proofImageUrl:    s.proofImageUrl,
  proofVideoUrl:    s.proofVideoUrl,
  proofUploadedAt:  s.proofUploadedAt,
  xpEarned:         s.xpEarned,
  tokensDeducted:   s.tokensDeducted,
  notes:            s.notes,
  incompleteReason: s.incompleteReason,
  challengeId:      s.challengeId,
  challengeTitle:   s.challenge?.title ?? null,
  chatId:           s.chatId,
  participants:     (s.participants ?? []).map(p => ({
    id:        p.id,
    userId:    p.userId,
    name:      `${p.user.firstName} ${p.user.lastName}`,
    avatarUrl: p.user.avatarUrl,
    status:    p.status,           // pending | confirmed | declined
  })),
  createdAt:        s.createdAt,
});

// ── POST /sessions ─────────────────────────────────────────
const scheduleSession = async (req, res, next) => {
  try {
    const {
      buddyIds = [],    // array — [] for solo (but match required), [id] for buddy, [id,id,...] for group
      activity,
      scheduledAt,
      durationMins = 60,
      gymName,
      notes,
      challengeId,
    } = req.body;

    // Validate duration
    const validDurations = [45, 60, 90, 120];
    const duration = validDurations.includes(Number(durationMins))
        ? Number(durationMins) : 60;

    // Validate scheduledAt
    const dt = new Date(scheduledAt);
    if (isNaN(dt) || dt < new Date()) {
      return res_.error(res, 'scheduledAt must be a future date', 422);
    }

    // Calculate endTime
    const endTime = new Date(dt.getTime() + duration * 60 * 1000);

    // ── Match validation — REQUIRED even for solo ─────────
    // User must have at least one active match
    const anyMatch = await prisma.match.findFirst({
      where: {
        OR: [
          { userAId: req.user.id, status: 'active' },
          { userBId: req.user.id, status: 'active' },
        ],
      },
    });

    if (!anyMatch) {
      return res_.error(
        res,
        'You need at least one buddy match to schedule sessions. Find workout partners on Discover!',
        403
      );
    }

    // ── Validate each buddy in buddyIds ───────────────────
    const validatedBuddyIds = [];
    for (const bId of buddyIds) {
      if (bId === req.user.id) continue; // skip self

      const match = await prisma.match.findFirst({
        where: {
          OR: [
            { userAId: req.user.id, userBId: bId, status: 'active' },
            { userAId: bId, userBId: req.user.id, status: 'active' },
          ],
        },
      });

      if (!match) {
        return res_.error(
          res,
          `You can only invite your Seshlly buddies. No match found with user ${bId}`,
          403
        );
      }
      validatedBuddyIds.push(bId);
    }

    // Max 10 participants (including creator)
    if (validatedBuddyIds.length > 9) {
      return res_.error(res, 'Maximum 9 buddies allowed per session (10 total)', 422);
    }

    // buddyId = first buddy for backward compat (2-person session)
    const primaryBuddyId = validatedBuddyIds[0] ?? null;
    const isGroup        = validatedBuddyIds.length > 1;

    // ── Same-day duplicate check ─────────────────────────
    // Only one session allowed per buddy pair per day
    if (validatedBuddyIds.length > 0) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      for (const bId of validatedBuddyIds) {
        const existing = await prisma.workoutSession.findFirst({
          where: {
            status:      'scheduled',
            scheduledAt: { gte: todayStart, lte: todayEnd },
            OR: [
              { userId: req.user.id, buddyId: bId },
              { userId: bId, buddyId: req.user.id },
            ],
          },
        });

        if (existing) {
          const buddy = await prisma.user.findUnique({
            where:  { id: bId },
            select: { firstName: true },
          });
          return res_.error(
            res,
            `You already have a session scheduled with ${buddy?.firstName ?? 'this buddy'} today. You can book again tomorrow!`,
            409
          );
        }
      }
    }

    // ── Create group chat if 3+ people ───────────────────
    let chatId = null;
    if (isGroup) {
      // Create group chat
      const groupChat = await prisma.chat.create({
        data: {
          isGroup:   true,
          groupName: `${activity} Session`,
          members: {
            create: [
              { userId: req.user.id, isAdmin: true },
              ...validatedBuddyIds.map(id => ({ userId: id })),
            ],
          },
        },
      });
      chatId = groupChat.id;
    }

    // ── Create session ────────────────────────────────────
    const session = await prisma.workoutSession.create({
      data: {
        id:          uuid(),
        userId:      req.user.id,
        buddyId:     primaryBuddyId,
        activity,
        gymName:     gymName || null,
        scheduledAt: dt,
        durationMins: duration,
        endTime,
        notes:       notes || null,
        challengeId: challengeId || null,
        chatId:      chatId || null,
        status:      'scheduled', // always scheduled — invite status tracked in SessionParticipant
      },
      ...SESSION_INCLUDE,
    });

    // ── Create participant records ─────────────────────────
    if (validatedBuddyIds.length > 0) {
      await prisma.sessionParticipant.createMany({
        data: [
          // Creator — auto confirmed
          { id: uuid(), sessionId: session.id, userId: req.user.id, status: 'confirmed', respondedAt: new Date() },
          // Invitees — pending
          ...validatedBuddyIds.map(bId => ({
            id: uuid(), sessionId: session.id, userId: bId, status: 'pending',
          })),
        ],
        skipDuplicates: true,
      });
    }

    // ── Send session_invite message in chat + notification ─
    const me = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: { firstName: true, lastName: true },
    });
    const myName = `${me.firstName} ${me.lastName}`;

    const inviteMetadata = {
      sessionId:   session.id,
      activity,
      scheduledAt: dt.toISOString(),
      endTime:     endTime.toISOString(),
      durationMins: duration,
      gymName:     gymName || null,
      challengeId: challengeId || null,
    };

    for (const bId of validatedBuddyIds) {
      // Find their 1-on-1 chat
      const chat1on1 = await prisma.chat.findFirst({
        where: {
          isGroup: false,
          OR: [
            { userAId: req.user.id, userBId: bId },
            { userAId: bId, userBId: req.user.id },
          ],
        },
      });

      if (chat1on1) {
        // Send session invite message
        await prisma.message.create({
          data: {
            id:       uuid(),
            chatId:   chat1on1.id,
            senderId: req.user.id,
            content:  `${myName} invited you to a ${activity} session on ${dt.toDateString()}`,
            type:     'session_invite',
            metadata: inviteMetadata,
          },
        });
      }

      // Push notification
      await notifSvc.notifySessionScheduled(bId, myName, session.id);
    }

    return res_.created(res, formatSession(session), 'Session scheduled');
  } catch (e) { next(e); }
};

// ── GET /sessions/my ───────────────────────────────────────
const getMySessions = async (req, res, next) => {
  try {
    const { status, page = 1 } = req.query;
    const take = 20;
    const skip = (Number(page) - 1) * take;

    const where = {
      OR: [
        { userId:  req.user.id },
        { buddyId: req.user.id },
        {
          participants: { some: { userId: req.user.id } },
        },
      ],
      ...(status ? { status } : {}),
    };

    const sessions = await prisma.workoutSession.findMany({
      where,
      orderBy: { scheduledAt: 'desc' },
      take,
      skip,
      ...SESSION_INCLUDE,
    });

    return res_.success(res, { sessions: sessions.map(s => formatSession(s, req.user.id)) });
  } catch (e) { next(e); }
};

// ── POST /sessions/:id/respond — Confirm or Decline invite ─
const respondToInvite = async (req, res, next) => {
  try {
    const { action } = req.body; // 'confirm' | 'decline'
    if (!['confirm', 'decline'].includes(action)) {
      return res_.error(res, 'action must be confirm or decline', 422);
    }

    const session = await prisma.workoutSession.findUnique({
      where:   { id: req.params.id },
      include: { participants: true },
    });
    if (!session) return res_.error(res, 'Session not found', 404);

    // Update participant status
    const participant = await prisma.sessionParticipant.findFirst({
      where: { sessionId: session.id, userId: req.user.id },
    });
    if (!participant) return res_.error(res, 'You are not invited to this session', 403);

    await prisma.sessionParticipant.update({
      where: { id: participant.id },
      data:  {
        status:      action === 'confirm' ? 'confirmed' : 'declined',
        respondedAt: new Date(),
      },
    });

    // If declined → notify creator, session stays 'scheduled'
    if (action === 'decline') {
      await notifSvc.sendNotification(session.userId, {
        type:    'session',
        title:   'Session Invite Declined',
        message: 'A buddy declined your session invite.',
        data:    { sessionId: session.id },
      });
      return res_.success(res, {}, 'Session declined');
    }

    // If confirmed → check if all participants confirmed
    const pending = await prisma.sessionParticipant.count({
      where: { sessionId: session.id, status: 'pending' },
    });

    if (pending === 0) {
      // All confirmed — notify creator
      await notifSvc.notifySessionConfirmed(session.userId, req.user.id, session.id);
    }

    return res_.success(res, {}, 'Response recorded');
  } catch (e) { next(e); }
};

// ── POST /sessions/:id/proof ───────────────────────────────
const uploadProof = async (req, res, next) => {
  try {
    const session = await prisma.workoutSession.findFirst({
      where: {
        id: req.params.id,
        OR: [
          { userId:  req.user.id },
          { buddyId: req.user.id },
          { participants: { some: { userId: req.user.id } } },
        ],
      },
      ...SESSION_INCLUDE,
    });
    if (!session) return res_.error(res, 'Session not found', 404);

    const { proofImageUrl } = req.body;
    if (!proofImageUrl) return res_.error(res, 'proofImageUrl is required', 422);

    const now     = new Date();
    const endTime = new Date(session.endTime);

    // Proof window: endTime → endTime + 3 hours
    if (now < endTime) {
      return res_.error(res, 'Session has not ended yet. Proof can be uploaded after session ends.', 422);
    }
    const proofDeadline = new Date(endTime.getTime() + 3 * 60 * 60 * 1000);
    if (now > proofDeadline) {
      return res_.error(res, 'Proof window closed — must upload within 3 hours of session end', 422);
    }

    const updated = await prisma.workoutSession.update({
      where: { id: session.id },
      data:  {
        proofImageUrl,
        proofUploadedAt: now,
        status: session.buddyId ? 'scheduled' : 'completed', // solo: completed immediately
        xpEarned: session.buddyId ? null : 50, // solo = immediate XP
      },
      ...SESSION_INCLUDE,
    });

    // Buddy session → notify buddy to confirm
    if (session.buddyId && session.buddyId !== req.user.id) {
      await notifSvc.notifyProofUploaded(session.buddyId, req.user.id, session.id);
    }

    return res_.success(res, formatSession(updated), 'Proof uploaded');
  } catch (e) { next(e); }
};

// ── POST /sessions/:id/confirm (buddy confirms proof) ──────
const confirmSession = async (req, res, next) => {
  try {
    const session = await prisma.workoutSession.findFirst({
      where: { id: req.params.id, buddyId: req.user.id, status: 'scheduled' },
      ...SESSION_INCLUDE,
    });
    if (!session) return res_.error(res, 'Session not found or not awaiting your confirmation', 404);

    // 2hr confirmation window
    const proofTime    = new Date(session.proofUploadedAt);
    const hoursElapsed = (new Date() - proofTime) / (1000 * 60 * 60);
    if (hoursElapsed > 2) {
      return res_.error(res, 'Confirmation window closed — must confirm within 2 hours of proof upload', 422);
    }

    // Mark completed first
    await prisma.workoutSession.update({
      where: { id: session.id },
      data:  { status: 'completed' },
    });

    // Award XP + Trust + Token to both users
    const participantCount = (session.participants?.length || 0) + 2;
    const xpResults = await xpCtrl.onSessionComplete(session, participantCount);

    const updated = await prisma.workoutSession.findFirst({
      where: { id: session.id },
      ...SESSION_INCLUDE,
    });

    await notifSvc.notifySessionConfirmed(session.userId, req.user.id, session.id);

    return res_.success(res, {
      session: formatSession(updated),
      rewards: xpResults,
    }, 'Session confirmed! XP and Trust awarded.');
  } catch (e) { next(e); }
};

// ── CRON: Mark sessions incomplete ────────────────────────
// Call this every 15 minutes via a scheduler
const markIncomplete = async () => {
  const now         = new Date();
  const deadline3hr = new Date(now.getTime() - 3 * 60 * 60 * 1000);

  // Find sessions whose proof window expired
  const expiredSessions = await prisma.workoutSession.findMany({
    where: {
      status:  'scheduled',
      endTime: { lt: deadline3hr },
    },
  });

  for (const session of expiredSessions) {
    // Apply Trust -5 + Token -1 + mark missed
    await xpCtrl.onSessionMissed(session);
  }

  return { marked: expiredSessions.length };
};

module.exports = {
  scheduleSession,
  getMySessions,
  uploadProof,
  confirmSession,
  respondToInvite,
  markIncomplete,
};
