'use strict';
// ─────────────────────────────────────────────────────────
//  gym.controller.js — Gym Map (Google Places) + buddy check-ins
//
//  GET    /gyms/nearby?lat=&lng=&radius=&q=   gyms from Google Places,
//                                              with "buddies here" merged in
//  GET    /gyms/buddies                         my buddies' active check-ins
//  GET    /gyms/checkin/me                      my active check-in
//  POST   /gyms/checkin  { placeId, gymName, lat, lng, address? }
//  DELETE /gyms/checkin                         end my check-in
//
//  Privacy (by design):
//   • Nobody is tracked. You appear on the map ONLY when you check in.
//   • Only your mutual buddies (active matches) see you, never strangers.
//   • Location shown = the gym, not your GPS point.
//   • Check-in auto-expires after 2 hours. Blocked users never see you.
//
//  Needs GOOGLE_MAPS_API_KEY (Places API (New) enabled) in .env.
// ─────────────────────────────────────────────────────────
const axios = require('axios');
const { v4: uuid } = require('uuid');
const prisma   = require('../config/db');
const res_     = require('../utils/response');
const notifSvc = require('../services/notification.service');
const { blockedIdsFor } = require('./safety.controller');

const CHECKIN_TTL_MS = 2 * 60 * 60 * 1000;
const CACHE_TTL_MS   = 6 * 60 * 60 * 1000; // Google results cached 6h per ~1km grid cell
const MAX_RADIUS_M   = 5000;

// ── Google Places (New) — Nearby / Text search ───────────
const _cache = new Map(); // key → { at, gyms }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache) if (now - v.at > CACHE_TTL_MS) _cache.delete(k);
}, 60 * 60 * 1000).unref?.();

const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.rating', 'places.userRatingCount', 'places.currentOpeningHours.openNow',
  'places.businessStatus',
].join(',');

const _mapPlace = (p) => ({
  placeId:     p.id,
  name:        p.displayName?.text || 'Gym',
  address:     p.formattedAddress || null,
  lat:         p.location?.latitude,
  lng:         p.location?.longitude,
  rating:      p.rating ?? null,
  ratingCount: p.userRatingCount ?? 0,
  openNow:     p.currentOpeningHours?.openNow ?? null,
});

const fetchGooglePlaces = async ({ lat, lng, radius, q }) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    const err = new Error('GOOGLE_MAPS_API_KEY not configured');
    err.code = 'MAPS_NOT_CONFIGURED';
    throw err;
  }
  // ~1.1 km grid so nearby users share the cached result (saves API cost)
  const cacheKey = `${lat.toFixed(2)}|${lng.toFixed(2)}|${radius}|${(q || '').toLowerCase()}`;
  const hit = _cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.gyms;

  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': key,
    'X-Goog-FieldMask': FIELD_MASK,
  };
  const circle = { center: { latitude: lat, longitude: lng }, radius };

  const { data } = q
    ? await axios.post('https://places.googleapis.com/v1/places:searchText', {
        textQuery: `${q} gym`,
        includedType: 'gym',
        maxResultCount: 20,
        locationBias: { circle },
        languageCode: 'en',
        regionCode: 'IN',
      }, { headers, timeout: 8000 })
    : await axios.post('https://places.googleapis.com/v1/places:searchNearby', {
        includedTypes: ['gym', 'fitness_center'],
        maxResultCount: 20,
        rankPreference: 'DISTANCE',
        locationRestriction: { circle },
        languageCode: 'en',
        regionCode: 'IN',
      }, { headers, timeout: 8000 });

  const gyms = (data.places || [])
    .filter(p => p.businessStatus !== 'CLOSED_PERMANENTLY' && p.location)
    .map(_mapPlace);
  _cache.set(cacheKey, { at: Date.now(), gyms });
  return gyms;
};

// ── Buddies helpers ──────────────────────────────────────
// Mutual buddies = active matches, minus blocked users
const _buddyIds = async (userId) => {
  const matches = await prisma.match.findMany({
    where: { status: 'active', OR: [{ userAId: userId }, { userBId: userId }] },
    select: { userAId: true, userBId: true },
  });
  const blocked = await blockedIdsFor(userId);
  return [...new Set(matches.map(m => (m.userAId === userId ? m.userBId : m.userAId)))]
    .filter(id => id && !blocked.has(id));
};

const _activeCheckins = async (userIds) => {
  if (!userIds.length) return [];
  return prisma.gymCheckin.findMany({
    where:   { userId: { in: userIds }, expiresAt: { gt: new Date() } },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

const _fmtCheckin = (c) => ({
  userId:      c.userId,
  name:        c.user ? `${c.user.firstName} ${c.user.lastName}`.trim() : undefined,
  firstName:   c.user?.firstName,
  avatarUrl:   c.user?.avatarUrl ?? null,
  placeId:     c.placeId,
  gymName:     c.gymName,
  address:     c.address,
  lat:         Number(c.latitude),
  lng:         Number(c.longitude),
  checkedInAt: c.createdAt,
  expiresAt:   c.expiresAt,
});

// GET /gyms/nearby
const nearby = async (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res_.error(res, 'lat and lng required', 422);
    }
    const radius = Math.min(Math.max(Number(req.query.radius) || 3000, 500), MAX_RADIUS_M);
    const q = (req.query.q || '').toString().trim().slice(0, 60) || null;

    let gyms;
    try {
      gyms = await fetchGooglePlaces({ lat, lng, radius, q });
    } catch (e) {
      if (e.code === 'MAPS_NOT_CONFIGURED') {
        return res_.error(res, 'Gym map is not configured yet', 503, { code: 'MAPS_NOT_CONFIGURED' });
      }
      console.error('[gyms.nearby] Google Places error:', e.response?.data || e.message);
      return res_.error(res, 'Could not load gyms right now', 502);
    }

    // Merge "buddies here"
    const checkins = await _activeCheckins(await _buddyIds(req.user.id));
    const byPlace = new Map();
    for (const c of checkins) {
      if (!byPlace.has(c.placeId)) byPlace.set(c.placeId, []);
      byPlace.get(c.placeId).push(_fmtCheckin(c));
    }

    return res_.success(res, {
      gyms: gyms.map(g => ({
        ...g,
        buddiesHere: byPlace.get(g.placeId) || [],
      })),
      source: 'google',
    });
  } catch (e) { next(e); }
};

// GET /gyms/buddies
const buddiesActive = async (req, res, next) => {
  try {
    const checkins = await _activeCheckins(await _buddyIds(req.user.id));
    // one row per buddy (latest check-in)
    const seen = new Set();
    const list = checkins.filter(c => !seen.has(c.userId) && seen.add(c.userId)).map(_fmtCheckin);
    return res_.success(res, { buddies: list });
  } catch (e) { next(e); }
};

// GET /gyms/checkin/me
const myCheckin = async (req, res, next) => {
  try {
    const c = await prisma.gymCheckin.findFirst({
      where: { userId: req.user.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return res_.success(res, { checkin: c ? _fmtCheckin(c) : null });
  } catch (e) { next(e); }
};

// POST /gyms/checkin
const checkIn = async (req, res, next) => {
  try {
    const { placeId, gymName, address } = req.body;
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (!placeId || !gymName || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res_.error(res, 'placeId, gymName, lat, lng required', 422);
    }
    const now = new Date();

    // only one active check-in at a time
    await prisma.gymCheckin.updateMany({
      where: { userId: req.user.id, expiresAt: { gt: now } },
      data:  { expiresAt: now },
    });
    const c = await prisma.gymCheckin.create({
      data: {
        id: uuid(), userId: req.user.id, placeId,
        gymName: String(gymName).slice(0, 120),
        address: address ? String(address).slice(0, 255) : null,
        latitude: lat, longitude: lng,
        expiresAt: new Date(now.getTime() + CHECKIN_TTL_MS),
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });

    // Tell buddies (counts toward their daily push cap; quiet hours respected)
    const buddies = (await _buddyIds(req.user.id)).slice(0, 50);
    for (const b of buddies) {
      await notifSvc.create({
        userId: b, type: 'match',
        title: `💪 ${c.user.firstName} training at ${c.gymName}`,
        message: 'Join karo ya ek Flash bhejo!',
        data: { kind: 'buddy_checkin', placeId, buddyId: req.user.id },
      });
    }

    return res_.created(res, { checkin: _fmtCheckin(c) }, `Checked in at ${c.gymName} for 2 hours`);
  } catch (e) { next(e); }
};

// DELETE /gyms/checkin
const checkOut = async (req, res, next) => {
  try {
    const now = new Date();
    await prisma.gymCheckin.updateMany({
      where: { userId: req.user.id, expiresAt: { gt: now } },
      data:  { expiresAt: now },
    });
    return res_.success(res, { checkin: null }, 'Checked out');
  } catch (e) { next(e); }
};

// CRON: delete check-ins older than 1 day
const cleanupCheckins = async () => {
  const r = await prisma.gymCheckin.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  return { deleted: r.count };
};

module.exports = { nearby, buddiesActive, myCheckin, checkIn, checkOut, cleanupCheckins, fetchGooglePlaces };
