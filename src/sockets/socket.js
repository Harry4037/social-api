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
        select: { id: true, firstName: true, isBanned: true },
      });
      if (!user || user.isBanned) return next(new Error('Unauthorized'));
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
    io.emit('user:online', { userId: uid });

    // ── Join a chat room ───────────────────────────────
    socket.on('chat:join', async ({ chatId }) => {
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, OR: [{ userAId: uid }, { userBId: uid }] },
      });
      if (chat) socket.join(`chat:${chatId}`);
    });

    socket.on('chat:leave', ({ chatId }) => {
      socket.leave(`chat:${chatId}`);
    });

    // ── Typing indicators ──────────────────────────────
    socket.on('typing:start', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('typing:start', { userId: uid, chatId });
    });

    socket.on('typing:stop', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('typing:stop', { userId: uid, chatId });
    });

    // ── Disconnect ─────────────────────────────────────
    socket.on('disconnect', () => {
      onlineUsers.get(uid)?.delete(socket.id);
      if (!onlineUsers.get(uid)?.size) {
        onlineUsers.delete(uid);
        io.emit('user:offline', { userId: uid });
        prisma.user.update({ where: { id: uid }, data: { lastActiveAt: new Date() } }).catch(() => {});
      }
      logger.info(`Socket disconnected: ${uid}`);
    });
  });

  logger.info('Socket.io initialised');
};

const isOnline = (userId) => onlineUsers.has(userId);

module.exports = { initSocket, isOnline };
