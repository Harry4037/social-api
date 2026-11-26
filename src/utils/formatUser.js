'use strict';
const { levelName } = require('./xp');

const parseJson = (v, fallback = []) => {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch { return fallback; }
};

// Include this in user queries so profiles carry their photos:
//   include: { photos: PHOTOS_SELECT, _count: {...} }
const PHOTOS_SELECT = { orderBy: { order: 'asc' }, select: { url: true } };

// Profile photos in display order. The main photo (avatarUrl) always comes
// first so the carousel starts with it. (Before: photos were never sent,
// so swiping between profile photos showed nothing.)
const photoList = (u) => {
  const urls = Array.isArray(u.photos)
    ? u.photos.map(p => (typeof p === 'string' ? p : p?.url)).filter(Boolean)
    : [];
  if (u.avatarUrl && !urls.includes(u.avatarUrl)) urls.unshift(u.avatarUrl);
  else if (u.avatarUrl) { urls.splice(urls.indexOf(u.avatarUrl), 1); urls.unshift(u.avatarUrl); }
  return urls;
};

/** Full user object — returned to the authenticated user only */
const formatUser = (u) => ({
  id:                u.id,
  email:             u.email,
  firstName:         u.firstName,
  lastName:          u.lastName,
  username:          u.username,
  avatarUrl:         u.avatarUrl,
  photos:            photoList(u),
  profileVisibility: u.profileVisibility ?? 'public',
  shareLocation:     u.shareLocation ?? true,
  showOnline:        u.showOnline ?? true,
  ghostMode:         !!(u.mapGhostUntil && new Date(u.mapGhostUntil) > new Date()),
  ghostUntil:        u.mapGhostUntil && new Date(u.mapGhostUntil) > new Date() ? u.mapGhostUntil : null,
  phone:             u.phone,
  bio:               u.bio,
  country:           u.country,
  city:              u.city,
  latitude:          u.latitude  ? Number(u.latitude)  : null,
  longitude:         u.longitude ? Number(u.longitude) : null,
  status:            u.status,
  emailVerified:     u.emailVerified,
  isBanned:          u.isBanned,
  loginCount:        u.loginCount,
  lastLoginAt:       u.lastLoginAt,
  createdAt:         u.createdAt,
  // Profile
  gender:            u.gender,
  walkthroughSeen:   u.walkthroughSeen ?? false,
  // Fitness
  primaryActivity:   u.primaryActivity,
  activities:        parseJson(u.activities),
  experienceLevel:   u.experienceLevel,
  goals:             parseJson(u.goals),
  primaryGym:        u.primaryGym,
  searchRadius:      u.searchRadius ?? 10,
  // Gamification
  xpTotal:           u.xpTotal,
  weeklyXp:          u.weeklyXp ?? 0,
  monthlyXp:         u.monthlyXp ?? 0,
  level:             u.level,
  chatTokens:        u.chatTokens,
  trustScore:        Number(u.trustScore),
  idVerified:        u.idVerified,
  // Influencer
  isInfluencer:      u.isInfluencer,
  instagramHandle:   u.instagramHandle,
  instagramFollowers:u.instagramFollowers,
  // Subscription
  subscriptionPlan:  u.subscriptionPlan,
  subscriptionExpiry:u.subscriptionExpiry,
  // Computed counts (joined via _count in queries)
  buddyCount:        u._count?.matchesA          ?? u.buddyCount     ?? 0,
  sessionCount:      u._count?.sessionsAsUser     ?? u.sessionCount   ?? 0,
  challengeCount:    u._count?.challengeEntries   ?? u.challengeCount ?? 0,
});

/** Public profile — returned for discover cards and buddy views */
const formatBuddyProfile = (u, { compatibilityScore = 0, distanceKm = null, isOnline = false, isBoosted = false, isNew = false } = {}) => ({
  id:                 u.id,
  firstName:          u.firstName,
  lastName:           u.lastName,
  avatarUrl:          u.avatarUrl,
  photos:             photoList(u),
  bio:                u.bio,
  city:               u.city,
  primaryActivity:    u.primaryActivity,
  activities:         parseJson(u.activities),
  experienceLevel:    u.experienceLevel,
  goals:              parseJson(u.goals),
  primaryGym:         u.primaryGym,
  level:              u.level,
  levelName:          levelName(u.level),
  trustScore:         Number(u.trustScore),
  idVerified:         u.idVerified,
  isInfluencer:       u.isInfluencer,
  instagramHandle:    u.instagramHandle,
  buddyCount:         u._count?.matchesA ?? 0,
  sessionCount:       u._count?.sessionsAsUser ?? 0,
  subscriptionPlan:   u.subscriptionPlan,
  compatibilityScore,
  // Whole km only (min 1) — exact distances let anyone triangulate a location
  distanceKm: distanceKm == null || u.shareLocation === false
    ? null : Math.max(1, Math.round(Number(distanceKm))),
  isOnline:           u.showOnline === false ? false : isOnline,
  isPro:              u.subscriptionPlan !== 'free',
  isBoosted,
  isNew,               // joined < 48 h ago → "New" badge
});

module.exports = { formatUser, formatBuddyProfile, PHOTOS_SELECT, photoList };
