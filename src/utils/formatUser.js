'use strict';
const { levelName } = require('./xp');

const parseJson = (v, fallback = []) => {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch { return fallback; }
};

/** Full user object — returned to the authenticated user only */
const formatUser = (u) => ({
  id:                u.id,
  email:             u.email,
  firstName:         u.firstName,
  lastName:          u.lastName,
  username:          u.username,
  avatarUrl:         u.avatarUrl,
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
  // Fitness
  primaryActivity:   u.primaryActivity,
  activities:        parseJson(u.activities),
  experienceLevel:   u.experienceLevel,
  goals:             parseJson(u.goals),
  primaryGym:        u.primaryGym,
  // Gamification
  xpTotal:           u.xpTotal,
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
  buddyCount:        u._count?.matchesA ?? u.buddyCount  ?? 0,
  sessionCount:      u._count?.sessionsAsUser ?? u.sessionCount ?? 0,
});

/** Public profile — returned for discover cards and buddy views */
const formatBuddyProfile = (u, { compatibilityScore = 0, distanceKm = null, isOnline = false } = {}) => ({
  id:                 u.id,
  firstName:          u.firstName,
  lastName:           u.lastName,
  avatarUrl:          u.avatarUrl,
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
  distanceKm,
  isOnline,
  isPro:              u.subscriptionPlan !== 'free',
});

module.exports = { formatUser, formatBuddyProfile };
