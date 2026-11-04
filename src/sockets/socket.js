'use strict';
const { verifyAccess } = require('../utils/jwt');
const prisma = require('../config/db');
const logger = require('../config/logger');

// Active user socket map: userId → Set<socketId>
const onlineUsers = new Map();

const initSocket = (io) => {
  // ── Auth middleware ────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.slice(7);
    if (!token) return next(new Error('No token'));
    try {
      const payload = verifyAccess(token);
      const user = await prisma.user.findUnique({
        where:  { id: payload.sub },
        select: { id: true, firstName: true, isBanned: true, status: true },
      });
      if (!user || user.isBanned || user.status === 'BANNED') return next(new Error('Unauthorized'));
      socket.userId = user.id;
      socket.userName = user.firstName;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.userId;
    logger.info(`Socket connected: ${uid}`);

    // Track online
    if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
    onlineUsers.get(uid).add(socket.id);

    // Update lastActiveAt
    prisma.user.update({ where: { id: uid }, data: { lastActiveAt: new Date() } }).catch(() => {});
    // Personal room → lets the server reach every device of this user
    socket.join(`user:${uid}`);
    // (Presence was broadcast to EVERY connected client — including people
    // who blocked this user. Nothing in the app listens to it, so it's gone.)

    // ── Join a chat room ───────────────────────────────
    socket.on('chat:join', async ({ chatId } = {}) => {
      if (typeof chatId !== 'string' || chatId.length > 64) return;
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, OR: [{ userAId: uid }, { userBId: uid }, { members: { some: { userId: uid } } }] },
      }).catch(() => null);
      if (chat && !chat.isGroup && chat.userAId && chat.userBId) {
        const { isBlockedBetween } = require('../controllers/safety.controller');
        if (await isBlockedBetween(chat.userAId, chat.userBId).catch(() => true)) return;
      }
      if (chat) {
        socket.join(`chat:${chatId}`);
        (socket.data.chats ||= new Set()).add(chatId);
      }
    });

    socket.on('chat:leave', ({ chatId } = {}) => {
      socket.leave(`chat:${chatId}`);
      socket.data.chats?.delete(chatId);
    });

    // ── Typing indicators (only in chats this socket really joined) ──
    socket.on('typing:start', ({ chatId } = {}) => {
      if (!socket.data.chats?.has(chatId)) return;
      socket.to(`chat:${chatId}`).emit('typing:start', { userId: uid, chatId });
    });

    socket.on('typing:stop', ({ chatId } = {}) => {
      if (!socket.data.chats?.has(chatId)) return;
      socket.to(`chat:${chatId}`).emit('typing:stop', { userId: uid, chatId });
    });

    // ── Disconnect ─────────────────────────────────────
    socket.on('disconnect', () => {
      onlineUsers.get(uid)?.delete(socket.id);
      if (!onlineUsers.get(uid)?.size) {
        onlineUsers.delete(uid);
        prisma.user.update({ where: { id: uid }, data: { lastActiveAt: new Date() } }).catch(() => {});
      }
      logger.info(`Socket disconnected: ${uid}`);
    });
  });

  logger.info('Socket.io initialised');
};

const isOnline = (userId) => onlineUsers.has(userId);

/** Ban / suspend: drop every live socket of this user right away */
const disconnectUser = (io, userId) => {
  io?.in(`user:${userId}`).disconnectSockets(true);
};

module.exports = { initSocket, isOnline, disconnectUser };
