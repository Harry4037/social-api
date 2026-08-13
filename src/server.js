'use strict';
require('dotenv').config();

const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const path        = require('path');

const logger      = require('./config/logger');
const prisma      = require('./config/db');
const { errorHandler, defaultLimiter } = require('./middleware/middleware');
const { initSocket } = require('./sockets/socket');
const { startJobs, stopJobs } = require('./schedulers/scheduler');
// CRON — markIncomplete sessions every 15 mins
require('./cron');
// CMS Routes
const cmsRouter    = require('./routes/cms.routes');
const strikeRouter = require('./routes/strike.routes');


const {
  userRouter, matchRouter, sessionRouter, chatRouter,
  notifRouter, subRouter, tokensRouter, uploadRouter,
  challengeRouter, globalLeaderboardRouter, feedRouter,
} = require('./routes/index');
const authRoutes  = require('./routes/auth.routes');
const adminRoutes = require('./admin/routes/admin.routes');

// ── App ───────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────
const allowedOrigins = process.env.NODE_ENV === 'development'
  ? true   // allow all origins in dev
  : (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

const io = new Server(server, {
  cors: {
    origin:  allowedOrigins,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});
initSocket(io);
app.set('io', io);

// ── Core Middleware ───────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin:      allowedOrigins,
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: (m) => logger.info(m.trim()) },
}));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads')));

// ── Health Check ──────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'disconnected' });
  }
});

// ── API Routes ────────────────────────────────────────────
const API = `/api/${process.env.API_VERSION || 'v1'}`;

app.use(defaultLimiter);
app.use(`${API}/auth`,          authRoutes);
app.use(`${API}/users`,         userRouter);
app.use(`${API}/match`,         matchRouter);
app.use(`${API}/sessions`,      sessionRouter);
app.use(`${API}/chat`,          chatRouter);
app.use(`${API}/notifications`, notifRouter);
app.use(`${API}/subscriptions`,      subRouter);
app.use(`${API}/tokens`,             tokensRouter);
app.use(`${API}/upload`,             uploadRouter);
app.use(`${API}/challenges`,         challengeRouter);
app.use(`${API}/global-leaderboard`, globalLeaderboardRouter);
app.use(`${API}/feed`,               feedRouter);
app.use('/api/cms',                  cmsRouter);     // Website CMS panel
app.use(`${API}/strikes`,            strikeRouter);  // Strike 2 — Buddy Strike
app.use(`${API}/admin`,              adminRoutes);

// ── 404 ───────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// ── Global error handler ──────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await prisma.$connect();
    logger.info('✅  Database connected');

    server.listen(PORT, () => {
      logger.info(`🚀  FitConnect API running on port ${PORT}`);
      logger.info(`    ${API}/auth  |  ${API}/match  |  ${API}/sessions  etc.`);
    });

    startJobs();
  } catch (e) {
    logger.error('Failed to start: ' + e.message);
    process.exit(1);
  }
};

// ── Graceful Shutdown ─────────────────────────────────────
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down`);
  stopJobs();
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection: ' + reason));
process.on('uncaughtException',  (err)    => { logger.error('Uncaught exception: ' + err.message); process.exit(1); });

startServer();

module.exports = { app, server };
