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
//  Gym data: Google Places (New) when GOOGLE_MAPS_API_KEY is set; if the
//  key is missing or Google fails, free OpenStreetMap data (Overpass API)
//  is used instead, so the map is never empty.
//  OVERPASS_URL can point to your own Overpass server (default: public one).
// ─────────────────────────────────────────────────────────
const axios = require('axios');
const { v4: uuid } = require('uuid');
const prisma   = require('../config/db');
const res_     = require('../utils/response');
const notifSvc = require('../services/notification.service');
const { blockedIdsFor } = require('./safety.controller');

const CHECKIN_TTL_MS = 2 * 60 * 60 * 1000;
const CHECKIN_MAX_DISTANCE_M = Number(process.env.CHECKIN_MAX_DISTANCE_M) || 500; // must be at the gym
const CHECKIN_COOLDOWN_MS    = 10 * 60 * 1000; // buddies are notified on every check-in
const CACHE_TTL_MS   = 6 * 60 * 60 * 1000; // Google results cached 6h per ~1km grid cell
const MAX_RADIUS_M   = 5000;

// ── Google Places (New) — Nearby / Text search ───────────
const _cache = new Map(); // key → { at, gyms }
const STALE_KEEP_MS = 7 * 24 * 60 * 60 * 1000; // old list kept as a fallback
const FAIL_MEMORY_MS = 60 * 1000;
const _inflight = new Map(); // key → Promise (one API call per area at a time)
const _failedAt = new Map(); // key → time of last failure
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache) if (now - v.at > STALE_KEEP_MS) _cache.delete(k);
  for (const [k, t] of _failedAt) if (now - t > FAIL_MEMORY_MS) _failedAt.delete(k);
}, 60 * 60 * 1000).unref?.();

// Load test (1000 users): every map open called the gym API. Now:
//  • fresh cache (6 h) → no call
//  • same area already loading → wait for that one call
//  • it failed < 1 min ago → don't call again (serve old list or fail fast)
//  • call fails → serve the last good list if we have one
const _cachedFetch = async (cacheKey, load) => {
  const hit = _cache.get(cacheKey);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.gyms;
  const failed = _failedAt.get(cacheKey);
  if (failed && now - failed < FAIL_MEMORY_MS) {
    if (hit) return hit.gyms;
    throw new Error('gym source failed recently');
  }
  if (_inflight.has(cacheKey)) return _inflight.get(cacheKey);
  const p = (async () => {
    try {
      const gyms = await load();
      _cache.set(cacheKey, { at: Date.now(), gyms });
      _failedAt.delete(cacheKey);
      return gyms;
    } catch (e) {
      _failedAt.set(cacheKey, Date.now());
      if (hit) return hit.gyms; // stale but useful
      throw e;
    } finally {
      _inflight.delete(cacheKey);
    }
  })();
  _inflight.set(cacheKey, p);
  return p;
};

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

// ── OpenStreetMap (Overpass) — free fallback ─────────────
// Search text goes into an Overpass regex → keep only letters, digits,
// spaces and ' & - (no dots, quotes, brackets, regex tricks)
const _osmEscape = (q) => String(q).normalize('NFKC')
  .replace(/[^\p{L}\p{M}\p{N} '&-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const _overpassQuery = ({ lat, lng, radius, q }) => {
  const around = `around:${Math.round(radius)},${lat},${lng}`;
  const name = q ? `["name"~"${_osmEscape(q)}",i]` : '';
  return `[out:json][timeout:15];(` +
    `node["leisure"="fitness_centre"]${name}(${around});` +
    `way["leisure"="fitness_centre"]${name}(${around});` +
    `node["amenity"="gym"]${name}(${around});` +
    `way["amenity"="gym"]${name}(${around});` +
    `);out center 40;`;
};
const _mapOsm = (el) => {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!t.name || lat == null || lng == null) return null;
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const address = [street, t['addr:suburb'], t['addr:city']].filter(Boolean).join(', ') || null;
  return {
    placeId: `osm:${el.type}/${el.id}`, name: t.name, address,
    lat: Number(lat), lng: Number(lng), rating: null, ratingCount: 0, openNow: null,
  };
};
const fetchOsmGyms = async ({ lat, lng, radius, q }) => {
  const cacheKey = `osm|${lat.toFixed(2)}|${lng.toFixed(2)}|${radius}|${(q || '').toLowerCase()}`;
  return _cachedFetch(cacheKey, async () => {
  const url = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
  const { data } = await axios.post(url,
    'data=' + encodeURIComponent(_overpassQuery({ lat, lng, radius, q })),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Seshlly/1.0' }, timeout: 15000 });
  const seen = new Set();
  const gyms = (data?.elements || []).map(_mapOsm).filter(Boolean)
    .filter(g => !seen.has(g.name + g.lat.toFixed(4)) && seen.add(g.name + g.lat.toFixed(4)))
    .sort((a, b) => _dist(lat, lng, a.lat, a.lng) - _dist(lat, lng, b.lat, b.lng))
    .slice(0, 40);
  return gyms;
  });
};

// metres between two points
const _dist = (lat1, lng1, lat2, lng2) => {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// A gym we have actually seen (cache from /gyms/nearby), else look it up
// around the user. Returns null if no such gym exists near them.
const _findGym = async (placeId, nearLat, nearLng) => {
  for (const { gyms } of _cache.values()) {
    const g = gyms.find(x => x.placeId === placeId);
    if (g) return g;
  }
  const radius = Math.max(CHECKIN_MAX_DISTANCE_M * 2, 1000);
  const sources = String(placeId).startsWith('osm:') ? [fetchOsmGyms] : [fetchGooglePlaces, fetchOsmGyms];
  for (const fetch of sources) {
    try {
      const gyms = await fetch({ lat: nearLat, lng: nearLng, radius, q: null });
      const g = gyms.find(x => x.placeId === placeId);
      if (g) return g;
    } catch (_) {/* try next source */}
  }
  return null;
};

const fetchGooglePlaces = async ({ lat, lng, radius, q }) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    const err = new Error('GOOGLE_MAPS_API_KEY not configured');
    err.code = 'MAPS_NOT_CONFIGURED';
    throw err;
  }
  // ~1.1 km grid so nearby users share the cached result (saves API cost)
  const cacheKey = `${lat.toFixed(2)}|${lng.toFixed(2)}|${radius}|${(q || '').toLowerCase()}`;
  return _cachedFetch(cacheKey, async () => {
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
  return gyms;
  });
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

// Ghost Mode users are left out of every buddy view of the map
const notGhost = () => ({ OR: [{ mapGhostUntil: null }, { mapGhostUntil: { lte: new Date() } }] });

const _activeCheckins = async (userIds) => {
  if (!userIds.length) return [];
  return prisma.gymCheckin.findMany({
    where:   {
      userId: { in: userIds }, expiresAt: { gt: new Date() },
      user: { status: 'ACTIVE', isBanned: false, ...notGhost() },
    },
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

    let gyms, source = 'google';
    try {
      gyms = await fetchGooglePlaces({ lat, lng, radius, q });
    } catch (e) {
      if (e.code !== 'MAPS_NOT_CONFIGURED') {
        console.error('[gyms.nearby] Google Places error:', e.response?.data || e.message);
      }
      try {
        gyms = await fetchOsmGyms({ lat, lng, radius, q });
        source = 'osm';
      } catch (e2) {
        console.error('[gyms.nearby] OpenStreetMap error:', e2.message);
        return res_.error(res, 'Could not load gyms right now — pull to retry', 502);
      }
    }

    // Merge "buddies here"
    const checkins = await _activeCheckins(await _buddyIds(req.user.id));
    const byPlace = new Map();
    for (const c of checkins) {
      if (!byPlace.has(c.placeId)) byPlace.set(c.placeId, []);
      byPlace.get(c.placeId).push(_fmtCheckin(c));
    }

    // Everyone training at these gyms now — a number only (no names)
    const counts = new Map();
    const placeIds = gyms.map(g => g.placeId).filter(Boolean);
    if (placeIds.length) {
      const rows = await prisma.gymCheckin.groupBy({
        by: ['placeId', 'userId'], // one per person, even after 2 check-ins
        where: {
          placeId: { in: placeIds }, expiresAt: { gt: new Date() },
          user: { status: 'ACTIVE', isBanned: false, ...notGhost() },
        },
        _count: { _all: true },
      });
      for (const r of rows) counts.set(r.placeId, (counts.get(r.placeId) || 0) + 1);
    }

    return res_.success(res, {
      gyms: gyms.map(g => ({
        ...g,
        buddiesHere: byPlace.get(g.placeId) || [],
        trainingNow: counts.get(g.placeId) || 0,
      })),
      source,
    });
  } catch (e) { next(e); }
};

// ── Buddy Map ────────────────────────────────────────────
// Never an exact position: a gym check-in shows the gym; otherwise a ~3 km
// grid cell centre (people close together get the same point, so it can't
// be used to triangulate). Buddies only, active in the last 24 h.
const AREA_KM = 3;
const AREA_ACTIVE_MS = 24 * 3600 * 1000;
const areaPoint = (lat, lng) => {
  const dLat = AREA_KM / 111.32;
  const latC = (Math.floor(lat / dLat) + 0.5) * dLat;
  const dLng = AREA_KM / (111.32 * Math.max(0.1, Math.cos(latC * Math.PI / 180)));
  const lngC = (Math.floor(lng / dLng) + 0.5) * dLng;
  return { lat: Number(latC.toFixed(5)), lng: Number(lngC.toFixed(5)) };
};

// GET /gyms/map
const buddyMap = async (req, res, next) => {
  try {
    const ids = await _buddyIds(req.user.id);
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { mapGhostUntil: true } });
    const ghostUntil = me?.mapGhostUntil && me.mapGhostUntil > new Date() ? me.mapGhostUntil : null;
    const out = [];
    if (ids.length) {
      const checkins = await _activeCheckins(ids);
      const seen = new Set();
      for (const c of checkins) {
        if (seen.has(c.userId)) continue;
        seen.add(c.userId);
        out.push({
          userId: c.userId, firstName: c.user?.firstName, avatarUrl: c.user?.avatarUrl ?? null,
          trainingNow: true, precision: 'gym',
          placeId: c.placeId, gymName: c.gymName,
          lat: Number(c.latitude), lng: Number(c.longitude), at: c.createdAt,
        });
      }
      const rest = ids.filter((id) => !seen.has(id));
      if (rest.length) {
        const users = await prisma.user.findMany({
          where: {
            id: { in: rest }, status: 'ACTIVE', isBanned: false, shareLocation: true,
            latitude: { not: null }, longitude: { not: null },
            lastActiveAt: { gt: new Date(Date.now() - AREA_ACTIVE_MS) },
            ...notGhost(),
          },
          select: { id: true, firstName: true, avatarUrl: true, latitude: true, longitude: true, lastActiveAt: true },
          take: 500,
        });
        for (const u of users) {
          out.push({
            userId: u.id, firstName: u.firstName, avatarUrl: u.avatarUrl ?? null,
            trainingNow: false, precision: 'area', areaKm: AREA_KM,
            ...areaPoint(Number(u.latitude), Number(u.longitude)), at: u.lastActiveAt,
          });
        }
      }
    }
    return res_.success(res, { buddies: out, me: { ghostMode: !!ghostUntil, ghostUntil } });
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
    const { placeId } = req.body;
    const myLat = Number(req.body.myLat);
    const myLng = Number(req.body.myLng);
    if (!placeId || !Number.isFinite(Number(req.body.lat)) || !Number.isFinite(Number(req.body.lng))) {
      return res_.error(res, 'placeId, gymName, lat, lng required', 422);
    }
    // You can only check in where you are (buddies get a notification)
    if (!Number.isFinite(myLat) || !Number.isFinite(myLng)) {
      return res_.error(res, 'Turn on location to check in', 422);
    }
    // The gym's name + position come from OUR gym data, not the client
    // (otherwise "myLat = lat" passed the distance check for any made-up gym)
    const gym = await _findGym(placeId, myLat, myLng);
    if (!gym) return res_.error(res, 'Gym not found — refresh the map and try again', 422);
    const { name: gymName, address } = gym;
    const lat = gym.lat, lng = gym.lng;
    const away = _dist(myLat, myLng, lat, lng);
    if (away > CHECKIN_MAX_DISTANCE_M) {
      return res_.error(res, `You need to be at ${String(gymName).slice(0, 60)} to check in (you are ${(away / 1000).toFixed(1)} km away)`, 403);
    }
    const now = new Date();
    const recent = await prisma.gymCheckin.findFirst({
      where: { userId: req.user.id, createdAt: { gt: new Date(now.getTime() - CHECKIN_COOLDOWN_MS) } },
      select: { id: true },
    });
    if (recent) return res_.error(res, 'You just checked in — try again in a few minutes', 429);

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
        message: 'Join them or send a Flash!',
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

module.exports = {
  nearby, buddiesActive, buddyMap, areaPoint, myCheckin, checkIn, checkOut, cleanupCheckins,
  fetchGooglePlaces, fetchOsmGyms,
  // for tests
  _mapOsm, _overpassQuery, _clearCache: () => { _cache.clear(); _failedAt.clear(); _inflight.clear(); },
  _expireCache: () => { for (const v of _cache.values()) v.at = 0; },
};
