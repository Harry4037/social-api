'use strict';
const prisma     = require('../config/db');
const { formatUser, formatBuddyProfile } = require('../utils/formatUser');
const res_       = require('../utils/response');

// PUT /users/me
const updateProfile = async (req, res, next) => {
  try {
    const {
      firstName, lastName, username, bio, city, country,
      primaryActivity, activities, experienceLevel, goals,
      primaryGym, latitude, longitude, instagramHandle, phone,
      avatarUrl,
    } = req.body;

    // Ensure username uniqueness when provided
    if (username) {
      const taken = await prisma.user.findFirst({
        where: { username, NOT: { id: req.user.id } },
      });
      if (taken) return res_.error(res, 'Username already taken', 409);
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(firstName       !== undefined && { firstName }),
        ...(lastName        !== undefined && { lastName }),
        ...(username        !== undefined && { username }),
        ...(bio             !== undefined && { bio }),
        ...(city            !== undefined && { city }),
        ...(country         !== undefined && { country }),
        ...(phone           !== undefined && { phone }),
        ...(avatarUrl       !== undefined && { avatarUrl }),
        ...(primaryActivity !== undefined && { primaryActivity }),
        ...(activities      !== undefined && { activities: JSON.stringify(activities) }),
        ...(experienceLevel !== undefined && { experienceLevel }),
        ...(goals           !== undefined && { goals: JSON.stringify(goals) }),
        ...(primaryGym      !== undefined && { primaryGym }),
        ...(latitude        !== undefined && { latitude }),
        ...(longitude       !== undefined && { longitude }),
        ...(instagramHandle !== undefined && { instagramHandle }),
      },
      include: { _count: { select: { matchesA: true, sessionsAsUser: true } } },
    });

    return res_.success(res, formatUser(user), 'Profile updated');
  } catch (e) { next(e); }
};

// GET /users/:id/profile
const getBuddyProfile = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where:   { id: req.params.id, status: 'ACTIVE', isBanned: false },
      include: { _count: { select: { matchesA: true, sessionsAsUser: true } } },
    });
    if (!user) return res_.error(res, 'User not found', 404);

    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    const { computeCompatibility, haversine } = require('../utils/compatibility');
    const compat  = computeCompatibility(me, user);
    const distKm  = me.latitude && me.longitude && user.latitude && user.longitude
      ? haversine(Number(me.latitude), Number(me.longitude), Number(user.latitude), Number(user.longitude))
      : null;

    // isOnline = active within 2 minutes
    const isOnline = user.lastActiveAt
      ? (Date.now() - new Date(user.lastActiveAt).getTime()) < 2 * 60 * 1000
      : false;

    return res_.success(res, formatBuddyProfile(user, { compatibilityScore: compat, distanceKm: distKm, isOnline }));
  } catch (e) { next(e); }
};

module.exports = { updateProfile, getBuddyProfile };
