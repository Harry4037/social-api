'use strict';
const { v4: uuid } = require('uuid');
const prisma     = require('../config/db');
const res_       = require('../utils/response');
const notifSvc   = require('../services/notification.service');
const { blockedIdsFor, isBlockedBetween } = require('./safety.controller');

const formatMessage = (m) => ({
  id:          m.id,
  chatId:      m.chatId,
  senderId:    m.senderId,
  senderName:  m.sender ? `${m.sender.firstName} ${m.sender.lastName}` : '',
  senderAvatar:m.sender?.avatarUrl || null,
  content:     m.content,
  type:        m.type,
  isRead:      m.isRead,
  readAt:      m.readAt,
  metadata:    m.metadata,
  expiresAt:   m.expiresAt ?? null,
  createdAt:   m.createdAt,
});

const DISAPPEAR_MS = 24 * 60 * 60 * 1000;
// Messages already past expiry are hidden even before the cron deletes them
const notExpired = () => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] });

// 1:1 chats: userA / userB. Group (session) chats: ChatMember rows.
const memberOf = (uid) => ({ OR: [{ userAId: uid }, { userBId: uid }, { members: { some: { userId: uid } } }] });

// GET /chat
const getChats = async (req, res, next) => {
  try {
    const { page, limit, skip } = require('../utils/paging').pageParams(req.query, { def: 50, max: 100 });
    const myId = req.user.id;

    // Hide chats with blocked users (either direction)
    const blocked = [...(await blockedIdsFor(myId))];
    // My chat ids via three indexed lookups — one big OR + EXISTS made MySQL
    // scan the whole chats table (load test: 8 000 rows read per call).
    const [asA, asB, asMember] = await Promise.all([
      prisma.chat.findMany({ where: { userAId: myId }, select: { id: true } }),
      prisma.chat.findMany({ where: { userBId: myId }, select: { id: true } }),
      prisma.chatMember.findMany({ where: { userId: myId }, select: { chatId: true } }),
    ]);
    const myChatIds = [...new Set([...asA.map(c => c.id), ...asB.map(c => c.id), ...asMember.map(m => m.chatId)])];
    const chatWhere = {
      id: { in: myChatIds },
      ...(blocked.length && {
        AND: [{ OR: [
          { isGroup: true },
          { userAId: { notIn: blocked }, userBId: { notIn: blocked } },
        ] }],
      }),
    };

    const [chats, total] = await Promise.all([
      prisma.chat.findMany({
        where: chatWhere,
        include: {
          userA: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, lastActiveAt: true, showOnline: true } },
          userB: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, lastActiveAt: true, showOnline: true } },
          messages: {
            where: notExpired(),
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.chat.count({ where: chatWhere }),
    ]);

    // Unread + member counts for THIS page of chats only (Prisma `_count`
    // grouped the whole messages table on every call)
    const pageIds = chats.map(c => c.id);
    const [unreadRows, memberRows] = pageIds.length ? await Promise.all([
      prisma.message.groupBy({
        by: ['chatId'], _count: { _all: true },
        where: { chatId: { in: pageIds }, isRead: false, NOT: { senderId: myId } },
      }),
      prisma.chatMember.groupBy({ by: ['chatId'], _count: { _all: true }, where: { chatId: { in: pageIds } } }),
    ]) : [[], []];
    const unreadOf = new Map(unreadRows.map(r => [r.chatId, r._count._all]));
    const membersOf = new Map(memberRows.map(r => [r.chatId, r._count._all]));
    for (const c of chats) c._count = { messages: unreadOf.get(c.id) || 0, members: membersOf.get(c.id) || 0 };

    const result = chats.map(c => {
      if (c.isGroup) {
        return {
          id: c.id, matchId: null, isGroup: true,
          buddyId: '', buddyName: c.groupName || 'Group session', buddyAvatar: null,
          memberCount: c._count.members, isOnline: false,
          lastMessage: c.messages[0]?.content || null,
          lastMessageAt: c.lastMessageAt,
          unreadCount: c._count.messages,
          disappearing: c.disappearing,
        };
      }
      const buddy = c.userAId === myId ? c.userB : c.userA;
      const isOnline = buddy.showOnline !== false && buddy.lastActiveAt
        ? (Date.now() - new Date(buddy.lastActiveAt).getTime()) < 2 * 60 * 1000
        : false;
      return {
        id:           c.id,
        matchId:     c.matchId,
        isGroup:      false,
        buddyId:      buddy.id,
        buddyName:    `${buddy.firstName} ${buddy.lastName}`,
        buddyAvatar:  buddy.avatarUrl,
        isOnline,
        lastMessage:  c.messages[0]?.content || null,
        lastMessageAt:c.lastMessageAt,
        unreadCount:  c._count.messages,
        disappearing: c.disappearing,
      };
    });

    return res_.paginated(res, result, { page, limit, total });
  } catch (e) { next(e); }
};

// GET /chat/:chatId/messages
const getMessages = async (req, res, next) => {
  try {
    const { page, limit, skip } = require('../utils/paging').pageParams(req.query, { def: 30, max: 100 });
    const myId  = req.user.id;

    const chat = await prisma.chat.findFirst({
      where: { id: req.params.chatId, ...memberOf(myId) },
    });
    if (!chat) return res_.error(res, 'Chat not found', 404);
    // Blocked (either direction) → chat is hidden
    if (!chat.isGroup && chat.userAId && chat.userBId &&
        await isBlockedBetween(chat.userAId, chat.userBId)) {
      return res_.error(res, 'Chat not found', 404);
    }

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where:   { chatId: chat.id, ...notExpired() },
        include: { sender: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        // Newest page first (page 1 = latest messages) …
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: Math.min(Number(limit) || 30, 100),
      }).then(rows => rows.reverse()), // … returned oldest → newest for display
      prisma.message.count({ where: { chatId: chat.id, ...notExpired() } }),
    ]);

    // `disappearing` lets the app show the 24h banner / toggle state
    return res.status(200).json({
      success: true,
      data: messages.map(formatMessage),
      disappearing: chat.disappearing,
      pagination: {
        page: Number(page), limit: Number(limit), total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  } catch (e) { next(e); }
};

// GET /chat/with/:userId → { chatId, matchId } of my active 1:1 chat with them
const chatWith = async (req, res, next) => {
  try {
    const me = req.user.id, other = req.params.userId;
    const chat = await prisma.chat.findFirst({
      where: {
        isGroup: false,
        OR: [{ userAId: me, userBId: other }, { userAId: other, userBId: me }],
        match: { status: 'active' },
      },
      select: { id: true, matchId: true },
    });
    if (!chat || await isBlockedBetween(me, other)) {
      return res_.error(res, 'Match with this person first to chat', 404);
    }
    return res_.success(res, { chatId: chat.id, matchId: chat.matchId });
  } catch (e) { next(e); }
};

// POST /chat/:chatId/messages
const sendMessage = async (req, res, next) => {
  try {
    const myId    = req.user.id;
    const { content, type = 'text' } = req.body;
    const metadata = undefined; // never trust client-made card data
    if (type === 'image') {
      const { isOwnUpload } = require('../utils/mediaUrl');
      if (!(await isOwnUpload(myId, content))) {
        return res_.error(res, 'Send photos with the in-app camera or gallery', 422);
      }
    }

    const chat = await prisma.chat.findFirst({
      where: { id: req.params.chatId, ...memberOf(myId) },
    });
    if (!chat) return res_.error(res, 'Chat not found', 404);
    // Blocked (either direction) → can't message
    if (!chat.isGroup && chat.userAId && chat.userBId &&
        await isBlockedBetween(chat.userAId, chat.userBId)) {
      return res_.error(res, 'You can no longer message this user', 403);
    }

    // Deduct one token for free users per message
    if (req.user.chatTokens < 1) {
      return res_.error(res, 'Insufficient chat tokens', 402);
    }
    // Pay first, atomically (check-then-decrement let parallel sends go negative)
    const paid = await prisma.user.updateMany({
      where: { id: myId, chatTokens: { gte: 1 } },
      data:  { chatTokens: { decrement: 1 }, lastActiveAt: new Date() },
    });
    if (paid.count === 0) return res_.error(res, 'Insufficient chat tokens', 402);

    // Message first; the chat's "last message" preview is updated on its own.
    // Both in one transaction deadlocked when both people typed at once
    // (load test: "write conflict or a deadlock" → 500).
    const [message] = await Promise.all([
      prisma.message.create({
        data: {
          id:       uuid(),
          chatId:   chat.id,
          senderId: myId,
          content,
          type,
          metadata: metadata || undefined,
          // 24h mode → this message auto-deletes; Normal → kept forever
          expiresAt: chat.disappearing ? new Date(Date.now() + DISAPPEAR_MS) : null,
        },
        include: { sender: { select: { firstName: true, lastName: true, avatarUrl: true } } },
      }),
    ]);
    // updateMany = no row lock wait on a missing row; newest time wins
    await prisma.chat.updateMany({
      where: { id: chat.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: message.createdAt } }] },
      data:  { lastMessage: content, lastMessageAt: message.createdAt },
    }).catch((e) => console.error('[sendMessage preview]', e.message));

    // Notify recipient(s) — every other member in a group chat
    const recipients = chat.isGroup
      ? (await prisma.chatMember.findMany({ where: { chatId: chat.id, NOT: { userId: myId } }, select: { userId: true } }))
          .map(m => m.userId)
      : [chat.userAId === myId ? chat.userBId : chat.userAId];
    const preview = content.length > 60 ? content.slice(0, 57) + '…' : content;
    for (const recipientId of recipients.filter(Boolean)) {
      await notifSvc.create({
        userId:    recipientId,
        type:      'chat',
        title:     chat.isGroup ? `${chat.groupName || 'Group'} 💬` : 'New Message 💬',
        message:   chat.isGroup ? `${message.sender.firstName}: ${preview}` : preview,
        actionUrl: `/chat/${chat.id}`,
        data:      { chatId: chat.id },
      });
    }

    // Warn if tokens low
    const remaining = req.user.chatTokens - 1;
    if (remaining <= 3) await notifSvc.notifyTokenLow(myId, remaining);

    // Emit via Socket.io if available
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chat.id}`).emit('message:new', formatMessage(message));
    }

    return res_.created(res, formatMessage(message), 'Message sent');
  } catch (e) { next(e); }
};

// PATCH /chat/:chatId/read
const markRead = async (req, res, next) => {
  try {
    const myId = req.user.id;
    const chat = await prisma.chat.findFirst({
      where: { id: req.params.chatId, ...memberOf(myId) },
    });
    if (!chat) return res_.error(res, 'Chat not found', 404);

    await prisma.message.updateMany({
      where: { chatId: chat.id, isRead: false, NOT: { senderId: myId } },
      data:  { isRead: true, readAt: new Date() },
    });

    return res_.success(res, null, 'Marked as read');
  } catch (e) { next(e); }
};

// PATCH /chat/:chatId/mode  { disappearing: true|false }
// Either member can switch. Only affects messages sent AFTER the switch.
const setMode = async (req, res, next) => {
  try {
    const myId = req.user.id;
    const disappearing = req.body.disappearing === true || req.body.disappearing === 'true';

    const chat = await prisma.chat.findFirst({
      where: { id: req.params.chatId, ...memberOf(myId) },
    });
    if (!chat) return res_.error(res, 'Chat not found', 404);
    if (chat.disappearing === disappearing) {
      return res_.success(res, { chatId: chat.id, disappearing }, 'No change');
    }

    const me = await prisma.user.findUnique({ where: { id: myId }, select: { firstName: true } });
    const content = disappearing
      ? `⏱ ${me?.firstName || 'Someone'} turned on 24h messages. New messages will disappear after 24 hours.`
      : `💬 ${me?.firstName || 'Someone'} turned off 24h messages. New messages will be kept.`;

    const [, sysMsg] = await prisma.$transaction([
      prisma.chat.update({ where: { id: chat.id }, data: { disappearing } }),
      prisma.message.create({
        data: {
          id: uuid(), chatId: chat.id, senderId: myId,
          content, type: 'system',
          metadata: { kind: 'chat_mode', disappearing },
        },
        include: { sender: { select: { firstName: true, lastName: true, avatarUrl: true } } },
      }),
    ]);

    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chat.id}`).emit('chat:mode', { chatId: chat.id, disappearing, byUserId: myId });
      io.to(`chat:${chat.id}`).emit('message:new', formatMessage(sysMsg));
    }

    return res_.success(res, { chatId: chat.id, disappearing, message: formatMessage(sysMsg) },
      disappearing ? '24h messages on' : '24h messages off');
  } catch (e) { next(e); }
};

module.exports = { getChats, getMessages, sendMessage, markRead, setMode, chatWith };
