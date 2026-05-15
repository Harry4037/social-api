'use strict';
const { v4: uuid } = require('uuid');
const prisma     = require('../config/db');
const res_       = require('../utils/response');
const notifSvc   = require('../services/notification.service');

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
  createdAt:   m.createdAt,
});

// GET /chat
const getChats = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const myId = req.user.id;
    const skip = (Number(page) - 1) * Number(limit);

    const [chats, total] = await Promise.all([
      prisma.chat.findMany({
        where: { OR: [{ userAId: myId }, { userBId: myId }] },
        include: {
          userA: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, lastActiveAt: true } },
          userB: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, lastActiveAt: true } },
          messages: {
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
      prisma.chat.count({ where: { OR: [{ userAId: myId }, { userBId: myId }] } }),
    ]);

    const result = chats.map(c => {
      const buddy = c.userAId === myId ? c.userB : c.userA;
      const isOnline = buddy.lastActiveAt
        ? (Date.now() - new Date(buddy.lastActiveAt).getTime()) < 2 * 60 * 1000
        : false;
      return {
        id:           c.id,
        buddyId:      buddy.id,
        buddyName:    `${buddy.firstName} ${buddy.lastName}`,
        buddyAvatar:  buddy.avatarUrl,
        isOnline,
        lastMessage:  c.messages[0]?.content || null,
        lastMessageAt:c.lastMessageAt,
        unreadCount:  c._count.messages,
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

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where:   { chatId: chat.id },
        include: { sender: { select: { firstName: true, lastName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'asc' },
        skip,
        take: Number(limit),
      }),
      prisma.message.count({ where: { chatId: chat.id } }),
    ]);

    return res_.paginated(res, messages.map(formatMessage), { page, limit, total });
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

module.exports = { getChats, getMessages, sendMessage, markRead };
