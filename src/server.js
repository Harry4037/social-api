'use strict';
require('dotenv').config();

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const helmet       = require('helmet');
const compression  = require('compression');
const morgan       = require('morgan');
const path         = require('path');

const logger      = require('./config/logger');
const prisma      = require('./config/db');
const { errorHandler, defaultLimiter } = require('./middleware/middleware');
const { initSocket }  = require('./sockets/socket');
const { startJobs, stopJobs } = require('./schedulers/scheduler');

const authRoutes      = require('./routes/auth.routes');
const adminRoutes     = require('./admin/routes/admin.routes');
const cmsRouter       = require('./routes/cms.routes');
const strikeRouter    = require('./routes/strike.routes');
const influencerRouter = require('./routes/influencer.routes');

const {
  userRouter,
  matchRouter,
  sessionRouter,
  chatRouter,
  notifRouter,
  subRouter,
  tokensRouter,
  uploadRouter,
  challengeRouter,
  globalLeaderboardRouter,
  leaderboardRouter,
  safetyRouter,
  gymRouter,
  feedRouter,
  referralRouter,
  brandAdsRouter,
  verifRouter,
  waitlistRouter,
  flashRouter,
} = require('./routes/index');

// ── App ───────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────
const allowedOrigins = process.env.NODE_ENV === 'development'
  ? true
  : (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});
initSocket(io);
app.set('io', io);
require('./controllers/session.controller').setIo(io); // cron jobs update chat cards live

// ── Core Middleware ───────────────────────────────────────
// Behind nginx / a cloud load balancer the real client IP is in
// X-Forwarded-For. Without this every user looks like the proxy's IP.
// TRUST_PROXY = number of proxies in front (default 1). Set 0 if exposed directly.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(compression());
app.use(express.json({
  limit: '2mb',
  // payment webhooks are signed over the exact bytes → keep them
  verify: (req, _res, buf) => { if (req.originalUrl.includes('/webhook')) req.rawBody = Buffer.from(buf); },
}));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
// Every list endpoint: page ≥ 1 and 1 ≤ limit ≤ 100 (garbage values used to
// reach Prisma → 500s, and limit=1000000 dumped whole tables)
app.use((req, _res, next) => {
  const q = req.query || {};
  if (q.page !== undefined)  q.page  = String(Math.max(1, Math.floor(Number(q.page)) || 1));
  if (q.limit !== undefined) q.limit = String(Math.min(100, Math.max(1, Math.floor(Number(q.limit)) || 20)));
  next();
});
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: (m) => logger.info(m.trim()) },
}));
app.use('/uploads', express.static(path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads')));

// ── security.txt (RFC 9116) — how researchers report a vulnerability ──
app.get('/.well-known/security.txt', (_req, res) => {
  const expires = new Date(Date.now() + 365 * 24 * 3600e3).toISOString();
  res.type('text/plain').send([
    `Contact: mailto:${process.env.SECURITY_CONTACT || 'security@seshlly.com'}`,
    `Expires: ${expires}`,
    'Preferred-Languages: en, hi',
    'Policy: Please give us 90 days to fix an issue before publishing it. Do not access other users\' data.',
    '',
  ].join('\n'));
});

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
// Retries with the same Idempotency-Key run once (see middleware/idempotency.js)
app.use(require('./middleware/idempotency').idempotency);

// Auth (public)
app.use(`${API}/auth`,              authRoutes);

// User-facing routes
app.use(`${API}/users`,             userRouter);
app.use(`${API}/match`,             matchRouter);
app.use(`${API}/sessions`,          sessionRouter);
app.use(`${API}/chat`,              chatRouter);
app.use(`${API}/notifications`,     notifRouter);
app.use(`${API}/subscriptions`,     subRouter);
app.use(`${API}/tokens`,            tokensRouter);
app.use(`${API}/upload`,            uploadRouter);
app.use(`${API}/challenges`,        challengeRouter);
app.use(`${API}/global-leaderboard`,globalLeaderboardRouter);
app.use(`${API}/leaderboard`,       leaderboardRouter);
app.use(`${API}/safety`,            safetyRouter);      // block / report
app.use(`${API}/gyms`,              gymRouter);         // gym map + check-ins
app.use(`${API}/feed`,              feedRouter);
app.use(`${API}/referral`,          referralRouter);
app.use(`${API}/brand-ads`,         brandAdsRouter);   // user: get active ad, track click/impression
app.use(`${API}/verification`,      verifRouter);      // user: submit/status
app.use(`${API}/waitlist`,          waitlistRouter);   // user: join
app.use(`${API}/flash`,             flashRouter);
app.use(`${API}/cms`,               cmsRouter);
app.use(`${API}/strikes`,           strikeRouter);
app.use(`${API}/influencer`,        influencerRouter);

// Admin panel (all admin routes under /admin)
app.use(`${API}/admin`,             adminRoutes);

// ── 404 ───────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// ── Global error handler ──────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // Weak / missing secrets in production → stop (anyone could forge logins)
  if (!require('./config/secrets').assertSecrets(logger)) process.exit(1);
  try {
    await prisma.$connect();
    logger.info('✅  Database connected');
    server.listen(PORT, () => {
      logger.info(`🚀  Seshlly API running on port ${PORT}`);
      logger.info(`    Environment: ${process.env.NODE_ENV || 'development'}`);
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

// Only start listening when run directly (`node src/server.js`).
// Tests `require()` this file to get the Express app without a live port.
if (require.main === module) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection: ' + reason));
  process.on('uncaughtException',  (err)    => { logger.error('Uncaught exception: ' + err.message); process.exit(1); });

  startServer();
}

module.exports = { app, server };
