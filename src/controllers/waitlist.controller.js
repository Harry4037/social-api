'use strict';
// ─────────────────────────────────────────────────────────
//  waitlist.controller.js
//  Waitlist Manager — per city/country
//  Auto notifications on launch date
// ─────────────────────────────────────────────────────────
const prisma     = require('../config/db');
const notifSvc   = require('../services/notification.service');
const res_       = require('../utils/response');
const { v4: uuid } = require('uuid');

// ── User joins waitlist ───────────────────────────────────
// POST /waitlist/join
const join = async (req, res, next) => {
  try {
    const { name, email, city, country = 'India',
            activity, source = 'app' } = req.body;

    if (!email) return res_.error(res, 'Email required', 400);

    // Find matching location
    const location = await prisma.waitlistLocation.findFirst({
      where: {
        OR: [{ city }, { city: 'All' }],
        country,
        isLaunched: false,
      },
    });

    // Check if already joined
    const existing = await prisma.waitlistEntry.findFirst({
      where: { email, locationId: location?.id },
    });
    if (existing) {
      return res_.success(res, {
        position: existing.position,
        message:  'Already on waitlist!',
      });
    }

    // Count for position
    const count = await prisma.waitlistEntry.count({
      where: { locationId: location?.id },
    });

    const entry = await prisma.waitlistEntry.create({
      data: {
        id:         uuid(),
        name:       name || email.split('@')[0],
        email,
        city,
        country,
        activity,
        source,
        position:   count + 1,
        locationId: location?.id,
        userId:     req.user?.id,
      },
    });

    // Auto welcome email/notification
    if (req.user?.id) {
      await notifSvc.send(req.user.id, 'waitlist_joined', {
        city,
        position: entry.position,
      });
    }

    return res_.created(res, {
      position: entry.position,
      message:  `You're #${entry.position} on the waitlist!`,
    });
  } catch(e) { next(e); }
};

// ── Admin: Get all locations ──────────────────────────────
// GET /admin/waitlist/locations
const getLocations = async (req, res, next) => {
  try {
    const locations = await prisma.waitlistLocation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { entries: true } },
      },
    });

    const result = await Promise.all(locations.map(async (loc) => {
      const fromApp = await prisma.waitlistEntry.count({
        where: { locationId: loc.id, source: 'app' },
      });
      const fromWeb = await prisma.waitlistEntry.count({
        where: { locationId: loc.id, source: 'web' },
      });
      return {
        ...loc,
        userCount: loc._count.entries,
        fromApp,
        fromWeb,
      };
    }));

    return res_.success(res, { locations: result });
  } catch(e) { next(e); }
};

// ── Admin: Add location ───────────────────────────────────
// POST /admin/waitlist/locations
const addLocation = async (req, res, next) => {
  try {
    const { city, country = 'India', launchDate, bannerOn = true } = req.body;
    if (!city) return res_.error(res, 'City required', 400);

    const location = await prisma.waitlistLocation.create({
      data: {
        id:         uuid(),
        city,
        country,
        launchDate: launchDate ? new Date(launchDate) : null,
        bannerOn,
        isLaunched: false,
      },
    });

    return res_.created(res, { location });
  } catch(e) { next(e); }
};

// ── Admin: Update location ────────────────────────────────
// PUT /admin/waitlist/locations/:id
const updateLocation = async (req, res, next) => {
  try {
    const { bannerOn, launchDate } = req.body;
    const data = {};
    if (bannerOn  !== undefined) data.bannerOn  = bannerOn;
    if (launchDate !== undefined) data.launchDate = launchDate
        ? new Date(launchDate) : null;

    const location = await prisma.waitlistLocation.update({
      where: { id: req.params.id },
      data,
    });
    return res_.success(res, { location });
  } catch(e) { next(e); }
};

// ── Admin: Launch city ────────────────────────────────────
// POST /admin/waitlist/locations/:id/launch
const launch = async (req, res, next) => {
  try {
    const location = await prisma.waitlistLocation.findUnique({
      where: { id: req.params.id },
    });
    if (!location) return res_.error(res, 'Location not found', 404);
    if (location.isLaunched) return res_.error(res, 'Already launched', 400);

    // Get all waitlist entries with userId (app users)
    const entries = await prisma.waitlistEntry.findMany({
      where: { locationId: location.id },
    });

    // 1. Send push notifications to app users
    const appUsers = entries.filter(e => e.userId);
    await Promise.allSettled(appUsers.map(entry =>
      notifSvc.send(entry.userId, 'city_launched', {
        city: location.city,
      })
    ));

    // 2. Credit 50 tokens to app users
    if (appUsers.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: appUsers.map(e => e.userId) } },
        data:  { chatTokens: { increment: 50 } },
      });
    }

    // 3. TODO: Send launch email to web users (email service)
    // const webUsers = entries.filter(e => !e.userId);
    // await emailSvc.sendLaunchEmail(webUsers, location.city);

    // 4. Mark as launched + banner OFF
    await prisma.waitlistLocation.update({
      where: { id: location.id },
      data: {
        isLaunched:  true,
        launchedAt:  new Date(),
        bannerOn:    false,
      },
    });

    return res_.success(res, {
      notified: appUsers.length,
      message:  `🚀 Launched! ${appUsers.length} users notified.`,
    });
  } catch(e) { next(e); }
};

// ── Admin: Stats ──────────────────────────────────────────
// GET /admin/waitlist/stats
const getStats = async (req, res, next) => {
  try {
    const total   = await prisma.waitlistEntry.count();
    const fromApp = await prisma.waitlistEntry.count({
      where: { source: 'app' }
    });
    const fromWeb = await prisma.waitlistEntry.count({
      where: { source: 'web' }
    });
    const today   = await prisma.waitlistEntry.count({
      where: {
        createdAt: { gte: new Date(new Date().setHours(0,0,0,0)) }
      }
    });

    return res_.success(res, { stats: { total, fromApp, fromWeb, today } });
  } catch(e) { next(e); }
};

// ── Admin: Export CSV ─────────────────────────────────────
// GET /admin/waitlist/export?locationId=xxx
const exportCsv = async (req, res, next) => {
  try {
    const where = req.query.locationId
        ? { locationId: req.query.locationId }
        : {};

    const entries = await prisma.waitlistEntry.findMany({
      where,
      orderBy: { position: 'asc' },
    });

    const csv = [
      'Position,Name,Email,City,Country,Activity,Source,Joined',
      ...entries.map(e =>
        `${e.position},${e.name},${e.email},${e.city},`+
        `${e.country},${e.activity || ''},${e.source},`+
        `${new Date(e.createdAt).toLocaleDateString('en-IN')}`
      ),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition',
      'attachment; filename=seshlly_waitlist.csv');
    return res.send(csv);
  } catch(e) { next(e); }
};

// ── CRON: Auto launch on date ─────────────────────────────
// Called from scheduler — checks if any location launch date = today
const autoLaunchCheck = async () => {
  try {
    const today    = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const due = await prisma.waitlistLocation.findMany({
      where: {
        isLaunched: false,
        launchDate: { gte: today, lt: tomorrow },
      },
    });

    for (const loc of due) {
      // Simulate request object for launch function
      const fakeReq = { params: { id: loc.id } };
      const fakeRes = {
        json: () => {},
        status: () => ({ json: () => {} }),
      };
      await launch(fakeReq, fakeRes, (e) => {
        if (e) console.error('[CRON] autoLaunch error:', e);
      });
      console.log(`[CRON] Auto-launched: ${loc.city}, ${loc.country}`);
    }

    return { launched: due.length };
  } catch(e) {
    console.error('[CRON] autoLaunchCheck:', e);
    return { launched: 0 };
  }
};

module.exports = {
  join, getLocations, addLocation,
  updateLocation, launch, getStats,
  exportCsv, autoLaunchCheck,
};
