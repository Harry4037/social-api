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

// GET /chat
const getChats = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const myId = req.user.id;
    const skip = (Number(page) - 1) * Number(limit);

    // Hide chats with blocked users (either direction)
    const blocked = [...(await blockedIdsFor(myId))];
    const chatWhere = {
      OR: [{ userAId: myId }, { userBId: myId }],
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
          userA: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, lastActiveAt: true } },
          userB: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, lastActiveAt: true } },
          messages: {
            where: notExpired(),
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: {
            select: {
              messages: {
                where: { isRead: false, NOT: { senderId: myId } },
              },
            },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.chat.count({ where: chatWhere }),
    ]);

    const result = chats.map(c => {
      const buddy = c.userAId === myId ? c.userB : c.userA;
      const isOnline = buddy.lastActiveAt
        ? (Date.now() - new Date(buddy.lastActiveAt).getTime()) < 2 * 60 * 1000
        : false;
      return {
        id:           c.id,
        matchId:     c.matchId,
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
    const { page = 1, limit = 30 } = req.query;
    const myId  = req.user.id;
    const skip  = (Number(page) - 1) * Number(limit);

    const chat = await prisma.chat.findFirst({
      where: { id: req.params.chatId, OR: [{ userAId: myId }, { userBId: myId }] },
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
        orderBy: { createdAt: 'asc' },
        skip,
        take: Number(limit),
      }),
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

// POST /chat/:chatId/messages
const sendMessage = async (req, res, next) => {
  try {
    const myId    = req.user.id;
    const { content, type = 'text', metadata } = req.body;

    const chat = await prisma.chat.findFirst({
      where: { id: req.params.chatId, OR: [{ userAId: myId }, { userBId: myId }] },
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

    const [message] = await prisma.$transaction([
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
      prisma.chat.update({
        where: { id: chat.id },
        data:  { lastMessage: content, lastMessageAt: new Date() },
      }),
      prisma.user.update({
        where: { id: myId },
        data:  { chatTokens: { decrement: 1 }, lastActiveAt: new Date() },
      }),
    ]);

    // Notify recipient
    const recipientId = chat.userAId === myId ? chat.userBId : chat.userAId;
    await notifSvc.create({
      userId:    recipientId,
      type:      'chat',
      title:     'New Message 💬',
      message:   content.length > 60 ? content.slice(0, 57) + '…' : content,
      actionUrl: `/chat/${chat.id}`,
      data:      { chatId: chat.id },
    });

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
      where: { id: req.params.chatId, OR: [{ userAId: myId }, { userBId: myId }] },
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
      where: { id: req.params.chatId, OR: [{ userAId: myId }, { userBId: myId }] },
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

module.exports = { getChats, getMessages, sendMessage, markRead, setMode };
