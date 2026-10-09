// ─────────────────────────────────────────────────────────
//  session.controller.js
//  POST   /sessions          → scheduleSession
//  GET    /sessions/my       → getMySessions
//  POST   /sessions/:id/proof → uploadProof
//  POST   /sessions/:id/confirm → confirmSession (other person confirms)
//  GET    /sessions/pending-confirm → getPendingConfirmations
//  CRON   processProofConfirmations → reminders + 2h timeout close
//  POST   /sessions/:id/respond → respondToInvite (confirm/decline)
//  CRON   markIncomplete     → called by scheduler
// ─────────────────────────────────────────────────────────
const prisma = require('../config/db');
const { v4: uuid } = require('uuid');
const res_ = require('../utils/response');
const notifSvc = require('../services/notification.service');
const xpCtrl = require('./xp.controller');

// ── Session include fields ─────────────────────────────────
const SESSION_INCLUDE = {
  include: {
    user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    buddy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
    challenge: { select: { id: true, title: true, activityTag: true } },
    participants: {
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    },
  },
};

const formatSession = (s, currentUserId = null) => ({
  id: s.id,
  userId: s.userId,
  buddyId: s.buddyId,
  buddyName: s.buddy
    ? `${s.buddy.firstName} ${s.buddy.lastName}` : null,
  buddyAvatar: s.buddy?.avatarUrl ?? null,
  activity: s.activity,
  gymName: s.gymName,
  scheduledAt: s.scheduledAt,
  durationMins: s.durationMins,
  endTime: s.endTime,
  // Session status: scheduled | completed | missed
  status: s.status,
  // Invite status from SessionParticipant: pending | confirmed | declined
  inviteStatus: currentUserId
    ? (s.participants?.find(p => p.userId === currentUserId)?.status ?? null)
    : null,
  proofImageUrl: s.proofImageUrl,
  proofVideoUrl: s.proofVideoUrl,
  proofUploadedAt: s.proofUploadedAt,
  proofUploadedBy: s.proofUploadedBy ?? null,
  confirmedAt: s.confirmedAt ?? null,
  confirmTimedOut: s.confirmTimedOut ?? false,
  confirmDeadline: s.proofUploadedAt && s.buddyId
    ? new Date(new Date(s.proofUploadedAt).getTime() + 2 * 60 * 60 * 1000)
    : null,
  xpEarned: s.xpEarned,
  tokensDeducted: s.tokensDeducted,
  notes: s.notes,
  incompleteReason: s.incompleteReason,
  challengeId: s.challengeId,
  challengeTitle: s.challenge?.title ?? null,
  chatId: s.chatId,
  participants: (s.participants ?? []).map(p => ({
    id: p.id,
    userId: p.userId,
    name: `${p.user.firstName} ${p.user.lastName}`,
    avatarUrl: p.user.avatarUrl,
    status: p.status,           // pending | confirmed | declined
  })),
  createdAt: s.createdAt,
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
    const isGroup = validatedBuddyIds.length > 1;

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
            status: 'scheduled',
            scheduledAt: { gte: todayStart, lte: todayEnd },
            OR: [
              { userId: req.user.id, buddyId: bId },
              { userId: bId, buddyId: req.user.id },
            ],
          },
        });

        if (existing) {
          const buddy = await prisma.user.findUnique({
            where: { id: bId },
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
          isGroup: true,
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
        id: uuid(),
        userId: req.user.id,
        buddyId: primaryBuddyId,
        activity,
        gymName: gymName || null,
        scheduledAt: dt,
        durationMins: duration,
        endTime,
        notes: notes || null,
        challengeId: challengeId || null,
        chatId: chatId || null,
        status: 'scheduled', // always scheduled — invite status tracked in SessionParticipant
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
      where: { id: req.user.id },
      select: { firstName: true, lastName: true },
    });
    const myName = `${me.firstName} ${me.lastName}`;

    const inviteMetadata = {
      sessionId: session.id,
      activity,
      scheduledAt: dt.toISOString(),
      endTime: endTime.toISOString(),
      durationMins: duration,
      gymName: gymName || null,
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
            id: uuid(),
            chatId: chat1on1.id,
            senderId: req.user.id,
            content: `${myName} invited you to a ${activity} session on ${dt.toDateString()}`,
            type: 'session_invite',
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
        { userId: req.user.id },
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
      where: { id: req.params.id },
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
      data: {
        status: action === 'confirm' ? 'confirmed' : 'declined',
        respondedAt: new Date(),
      },
    });

    // If declined → notify creator, session stays 'scheduled'
    if (action === 'decline') {
      await notifSvc.create({ userId: session.userId, type: 'session', title: 'Session Invite Declined', message: 'A buddy declined your session invite.', data: { sessionId: session.id } });
      return res_.success(res, {}, 'Session declined');
    }

    // If confirmed → check if all participants confirmed
    const pending = await prisma.sessionParticipant.count({
      where: { sessionId: session.id, status: 'pending' },
    });

    if (pending === 0) {
      // All confirmed — notify creator
      await notifSvc.create({ userId: session.userId, type: 'session', title: 'Session Confirmed', message: 'Your session was confirmed!', data: { sessionId: session.id } });
    }

    return res_.success(res, {}, 'Response recorded');
  } catch (e) { next(e); }
};

// ── POST /sessions/:id/proof ───────────────────────────────
const uploadProof = async (req, res, next) => {
  try {
    const myId = req.user.id;
    const session = await prisma.workoutSession.findFirst({
      where: {
        id: req.params.id,
        OR: [
          { userId: myId },
          { buddyId: myId },
          { participants: { some: { userId: myId } } },
        ],
      },
      ...SESSION_INCLUDE,
    });
    if (!session) return res_.error(res, 'Session not found', 404);

    if (session.status !== 'scheduled' || session.proofUploadedAt) {
      return res_.error(res, 'Proof already submitted for this session', 409);
    }

    const { proofImageUrl } = req.body;
    if (!proofImageUrl) return res_.error(res, 'proofImageUrl is required', 422);

    const now = new Date();
    const endTime = new Date(session.endTime);

    // Proof window: endTime → endTime + 3 hours
    if (now < endTime) {
      return res_.error(res, 'Session has not ended yet. Proof can be uploaded after session ends.', 422);
    }
    const proofDeadline = new Date(endTime.getTime() + 3 * 60 * 60 * 1000);
    if (now > proofDeadline) {
      return res_.error(res, 'Proof window closed — must upload within 3 hours of session end', 422);
    }

    // ── AI proof check (Hive) — only when HIVE_API_KEY is configured.
    // checkProofImage never blocks on API failure (returns valid: true).
    if (process.env.HIVE_API_KEY) {
      const { checkProofImage } = require('./verification.controller');
      const ai = await checkProofImage(proofImageUrl);
      if (!ai.valid) {
        return res_.error(res, ai.reason || 'Proof photo rejected. Please upload a real workout photo.', 422,
          { code: 'PROOF_REJECTED' });
      }
    }

    const isBuddySession = !!session.buddyId;

    // ── SOLO: complete immediately + actually award XP ──
    if (!isBuddySession) {
      const SOLO_XP = 50;
      await prisma.workoutSession.update({
        where: { id: session.id },
        data: {
          proofImageUrl,
          proofUploadedAt: now,
          proofUploadedBy: myId,
          status: 'completed',
          xpEarned: SOLO_XP,
        },
      });
      // Previously only "50" was written on the session — the user never got it.
      await xpCtrl.awardXP(myId, SOLO_XP, 'session_complete_solo', { sessionId: session.id });

      const updated = await prisma.workoutSession.findFirst({
        where: { id: session.id }, ...SESSION_INCLUDE,
      });
      return res_.success(res, formatSession(updated, myId), 'Proof uploaded! +50 XP');
    }

    // ── BUDDY: other person must confirm within 2h ──
    const updated = await prisma.workoutSession.update({
      where: { id: session.id },
      data: {
        proofImageUrl,
        proofUploadedAt: now,
        proofUploadedBy: myId,
        confirmReminders: 1, // reminder #1 = the notification below
      },
      ...SESSION_INCLUDE,
    });

    const confirmerId  = _confirmerOf(updated);
    const uploaderName = _firstName(updated, myId) || 'Your buddy';
    const potentialXp  = xpCtrl.calcSessionXP(updated, _participantCount(updated)) + 20;
    const deadline     = new Date(now.getTime() + CONFIRM_WINDOW_MS);

    if (confirmerId) {
      // Proof card in their 1:1 chat (one-tap confirm)
      await _postProofCard(req, updated, myId, confirmerId, deadline, potentialXp);
      // Push + in-app notification (#1)
      await notifSvc.notifyProofUploaded(confirmerId, uploaderName, session.id, {
        deadline: deadline.toISOString(),
      });
    }

    return res_.success(res, formatSession(updated, myId), 'Proof uploaded — waiting for buddy to confirm');
  } catch (e) { next(e); }
};

// ── POST /sessions/:id/confirm (the OTHER person confirms proof) ──
const confirmSession = async (req, res, next) => {
  try {
    const myId = req.user.id;
    const session = await prisma.workoutSession.findFirst({
      where: {
        id: req.params.id,
        status: 'scheduled',
        proofUploadedAt: { not: null },
        OR: [{ userId: myId }, { buddyId: myId }],
      },
      ...SESSION_INCLUDE,
    });
    if (!session) return res_.error(res, 'Session not found or not awaiting your confirmation', 404);

    // Uploader can't confirm their own proof
    const uploader = session.proofUploadedBy || session.userId; // legacy rows: creator uploaded
    if (uploader === myId) {
      return res_.error(res, 'You uploaded this proof — your buddy has to confirm it', 403);
    }

    // 2hr confirmation window
    const hoursElapsed = (Date.now() - new Date(session.proofUploadedAt).getTime()) / (1000 * 60 * 60);
    if (hoursElapsed > 2 || session.confirmTimedOut) {
      return res_.error(res, 'Confirmation window closed — must confirm within 2 hours of proof upload', 422);
    }

    // Atomic claim — protects against double confirm / cron timeout race
    const claim = await prisma.workoutSession.updateMany({
      where: { id: session.id, status: 'scheduled', confirmTimedOut: false },
      data:  { status: 'completed', confirmedAt: new Date() },
    });
    if (claim.count === 0) {
      return res_.error(res, 'Session already closed', 409);
    }

    // Award XP + Trust + Token to both users
    const participantCount = _participantCount(session);
    const xpResults = await xpCtrl.onSessionComplete(session, participantCount);

    await _updateProofCard(session.id, 'confirmed');

    const updated = await prisma.workoutSession.findFirst({
      where: { id: session.id },
      ...SESSION_INCLUDE,
    });

    await notifSvc.create({
      userId: uploader, type: 'session',
      title: 'Session Confirmed 💪',
      message: `${_firstName(session, myId) || 'Your buddy'} confirmed your proof! XP added.`,
      data: { sessionId: session.id },
    });

    return res_.success(res, {
      session: formatSession(updated, myId),
      rewards: xpResults,
    }, 'Session confirmed! XP and Trust awarded.');
  } catch (e) { next(e); }
};

// ── GET /sessions/pending-confirm — proofs waiting for ME ──
// Used by the home banner + chat proof card
const getPendingConfirmations = async (req, res, next) => {
  try {
    const myId = req.user.id;
    const since = new Date(Date.now() - CONFIRM_WINDOW_MS);
    const sessions = await prisma.workoutSession.findMany({
      where: {
        status: 'scheduled',
        confirmTimedOut: false,
        proofUploadedAt: { gte: since },
        buddyId: { not: null },
        OR: [{ userId: myId }, { buddyId: myId }],
      },
      orderBy: { proofUploadedAt: 'asc' },
      ...SESSION_INCLUDE,
    });

    const mine = sessions.filter(s => _confirmerOf(s) === myId);
    return res_.success(res, {
      sessions: mine.map(s => ({
        ...formatSession(s, myId),
        uploaderName: _firstName(s, myId),
        potentialXp:  xpCtrl.calcSessionXP(s, _participantCount(s)) + 20,
      })),
      count: mine.length,
    });
  } catch (e) { next(e); }
};

// ── CRON (every 5 min): reminders #2/#3 + 2h timeout close ──
const processProofConfirmations = async () => {
  const now = Date.now();
  const pending = await prisma.workoutSession.findMany({
    where: {
      status: 'scheduled',
      confirmTimedOut: false,
      proofUploadedAt: { not: null },
      buddyId: { not: null },
    },
    ...SESSION_INCLUDE,
  });

  let reminded = 0, closed = 0;
  for (const s of pending) {
    try {
      const confirmerId = _confirmerOf(s);
      const uploaderId  = s.proofUploadedBy || s.userId;
      if (!confirmerId) continue;

      const elapsedMin   = (now - new Date(s.proofUploadedAt).getTime()) / 60000;
      const pCount       = _participantCount(s);
      const baseXp       = xpCtrl.calcSessionXP(s, pCount);
      const uploaderName = _firstName(s, confirmerId) || 'Your buddy';
      const confirmerName = _firstName(s, uploaderId) || 'Your buddy';

      // ── 2h passed → close session ──
      if (elapsedMin >= CONFIRM_WINDOW_MS / 60000) {
        const claim = await prisma.workoutSession.updateMany({
          where: { id: s.id, status: 'scheduled', confirmTimedOut: false },
          data:  { status: 'completed', confirmTimedOut: true, xpEarned: baseXp },
        });
        if (claim.count === 0) continue;

        // Uploader did their part → full session XP (no confirm bonus), trust, token
        await xpCtrl.awardXP(uploaderId, baseXp, 'session_complete_unconfirmed', { sessionId: s.id });
        await xpCtrl.updateTrust(uploaderId, 2.0, 'session_complete');
        await xpCtrl.awardToken(uploaderId, 1, 'session_complete');

        // Confirmer loses their share + trust -2
        await xpCtrl.updateTrust(confirmerId, -2.0, 'proof_confirm_missed');

        await _updateProofCard(s.id, 'expired');
        await notifSvc.notifyProofAutoCompleted(uploaderId, confirmerName, s.id, baseXp);
        await notifSvc.notifyProofConfirmMissed(confirmerId, uploaderName, s.id, baseXp + 20);
        closed++;
        continue;
      }

      // ── Reminder #3 — 15 min left ──
      if (elapsedMin >= 105 && s.confirmReminders < 3) {
        await prisma.workoutSession.update({ where: { id: s.id }, data: { confirmReminders: 3 } });
        await notifSvc.notifyProofConfirmReminder(confirmerId, uploaderName, s.id, 15, baseXp + 20);
        reminded++;
        continue;
      }

      // ── Reminder #2 — after 1 hour ──
      if (elapsedMin >= 60 && s.confirmReminders < 2) {
        await prisma.workoutSession.update({ where: { id: s.id }, data: { confirmReminders: 2 } });
        await notifSvc.notifyProofConfirmReminder(confirmerId, uploaderName, s.id,
          Math.round(120 - elapsedMin), baseXp + 20);
        reminded++;
      }
    } catch (e) {
      console.error('[processProofConfirmations]', s.id, e.message);
    }
  }
  return { checked: pending.length, reminded, closed };
};

// ── GET confirm rate for a user ("Confirms on time: 92%") ──
const getConfirmRate = async (userId) => {
  const asConfirmer = await prisma.workoutSession.findMany({
    where: {
      buddyId: { not: null },
      proofUploadedAt: { not: null },
      OR: [{ userId }, { buddyId: userId }],
      NOT: { proofUploadedBy: userId },
      AND: [{ OR: [{ confirmedAt: { not: null } }, { confirmTimedOut: true }] }],
    },
    select: { confirmedAt: true, confirmTimedOut: true, proofUploadedBy: true },
  });
  const relevant = asConfirmer.filter(s => s.proofUploadedBy); // skip legacy rows
  if (!relevant.length) return null; // no history yet
  const onTime = relevant.filter(s => s.confirmedAt).length;
  return Math.round((onTime / relevant.length) * 100);
};

// ── Helpers ───────────────────────────────────────────────
const CONFIRM_WINDOW_MS = 2 * 60 * 60 * 1000;

const _participantCount = (s) => (s.participants?.length || 0) + 2;

// The person who must confirm = the other one of creator/buddy
const _confirmerOf = (s) => {
  const uploader = s.proofUploadedBy || s.userId;
  if (uploader === s.userId) return s.buddyId || null;
  if (uploader === s.buddyId) return s.userId;
  return s.userId; // a group participant uploaded → creator confirms
};

// First name of the OTHER person relative to `notThisId`
const _firstName = (s, notThisId) => {
  if (s.user && s.user.id !== notThisId) return s.user.firstName;
  if (s.buddy && s.buddy.id !== notThisId) return s.buddy.firstName;
  return null;
};

// Post a 'proof' card in the 1:1 chat between uploader and confirmer
const _postProofCard = async (req, session, uploaderId, confirmerId, deadline, potentialXp) => {
  try {
    const chat = await prisma.chat.findFirst({
      where: {
        isGroup: false,
        OR: [
          { userAId: uploaderId, userBId: confirmerId },
          { userAId: confirmerId, userBId: uploaderId },
        ],
      },
    });
    if (!chat) return;

    const content = '📸 Session proof — confirm karo';
    const message = await prisma.message.create({
      data: {
        id: uuid(),
        chatId: chat.id,
        senderId: uploaderId,
        content,
        type: 'proof',
        metadata: {
          sessionId:   session.id,
          imageUrl:    session.proofImageUrl,
          activity:    session.activity,
          uploaderId,
          confirmerId,
          deadline:    deadline.toISOString(),
          potentialXp,
          status:      'pending', // pending | confirmed | expired
        },
      },
      include: { sender: { select: { firstName: true, lastName: true, avatarUrl: true } } },
    });
    await prisma.chat.update({
      where: { id: chat.id },
      data:  { lastMessage: content, lastMessageAt: new Date() },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chat.id}`).emit('message:new', {
        id: message.id, chatId: message.chatId, senderId: message.senderId,
        senderName: `${message.sender.firstName} ${message.sender.lastName}`,
        senderAvatar: message.sender.avatarUrl || null,
        content: message.content, type: message.type, isRead: false,
        metadata: message.metadata, createdAt: message.createdAt,
      });
    }
  } catch (e) {
    console.error('[_postProofCard]', e.message); // never block proof upload
  }
};

// Update status on the chat proof card(s) for this session
const _updateProofCard = async (sessionId, status) => {
  try {
    const cards = await prisma.message.findMany({
      where: { type: 'proof', metadata: { path: '$.sessionId', equals: sessionId } },
    });
    for (const m of cards) {
      await prisma.message.update({
        where: { id: m.id },
        data:  { metadata: { ...(m.metadata || {}), status } },
      });
    }
  } catch (e) {
    console.error('[_updateProofCard]', e.message);
  }
};

// ── CRON: Mark sessions incomplete ────────────────────────
// Call this every 15 minutes via a scheduler
const markIncomplete = async () => {
  const now = new Date();
  const deadline3hr = new Date(now.getTime() - 3 * 60 * 60 * 1000);

  // Find sessions whose proof window expired
  const expiredSessions = await prisma.workoutSession.findMany({
    where: {
      status: 'scheduled',
      endTime: { lt: deadline3hr },
      proofUploadedAt: null, // proof uploaded = waiting for buddy confirm, not missed
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
  getPendingConfirmations,
  processProofConfirmations,
  getConfirmRate,
};
