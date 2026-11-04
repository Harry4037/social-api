'use strict';
const prisma     = require('../config/db');
const { withUserCounts, withUserCount } = require('../utils/relationCounts');
const { formatUser, formatBuddyProfile, PHOTOS_SELECT } = require('../utils/formatUser');
const res_       = require('../utils/response');

// PUT /users/me
const updateProfile = async (req, res, next) => {
  try {
    const {
      firstName, lastName, username, bio, city, country,
      gender, primaryActivity, activities, experienceLevel, goals,
      primaryGym, latitude, longitude, instagramHandle, phone,
      avatarUrl, walkthroughSeen, searchRadius,
      profileVisibility, shareLocation, showOnline,
    } = req.body;

    // A verified Instagram handle can't be swapped for someone else's
    if (instagramHandle !== undefined) {
      const cur = await prisma.user.findUnique({
        where: { id: req.user.id }, select: { instagramVerifiedAt: true, isInfluencer: true, instagramHandle: true },
      });
      if ((cur?.instagramVerifiedAt || cur?.isInfluencer) && instagramHandle !== cur.instagramHandle) {
        return res_.error(res, 'Your verified Instagram handle can only be changed by our team', 403);
      }
    }

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
        ...(gender           !== undefined && { gender }),
        ...(walkthroughSeen  !== undefined && { walkthroughSeen }),
        ...(primaryActivity  !== undefined && { primaryActivity }),
        ...(activities      !== undefined && { activities: JSON.stringify(activities) }),
        ...(experienceLevel !== undefined && { experienceLevel }),
        ...(goals           !== undefined && { goals: JSON.stringify(goals) }),
        ...(primaryGym      !== undefined && { primaryGym }),
        ...(latitude        !== undefined && { latitude }),
        ...(longitude       !== undefined && { longitude }),
        ...(searchRadius    !== undefined && { searchRadius: Number(searchRadius) }),
        ...(instagramHandle !== undefined && { instagramHandle }),
        ...(profileVisibility !== undefined && { profileVisibility }),
        ...(shareLocation   !== undefined && { shareLocation: !!shareLocation }),
        ...(showOnline      !== undefined && { showOnline: !!showOnline }),
      },
      include: { photos: PHOTOS_SELECT },
    });

    return res_.success(res, formatUser(await withUserCount(user, { challenges: true })), 'Profile updated');
  } catch (e) { next(e); }
};

// GET /users/:id/profile
const getBuddyProfile = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where:   { id: req.params.id, status: 'ACTIVE', isBanned: false },
      include: { photos: PHOTOS_SELECT },
    });
    if (!user) return res_.error(res, 'User not found', 404);
    await withUserCount(user, { challenges: true });
    // Blocked either way → profile hidden
    const { isBlockedBetween } = require('./safety.controller');
    if (await isBlockedBetween(req.user.id, user.id)) return res_.error(res, 'User not found', 404);
    // Buddies-only / hidden profiles: only buddies can open them
    if (user.id !== req.user.id && (user.profileVisibility || 'public') !== 'public') {
      const buddy = await prisma.match.findFirst({
        where: { status: 'active', OR: [
          { userAId: req.user.id, userBId: user.id }, { userAId: user.id, userBId: req.user.id }] },
        select: { id: true },
      });
      if (!buddy) return res_.error(res, 'User not found', 404);
    }

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

    // "Confirms on time: X%" — null when no confirm history yet
    const confirmRate = await require('./session.controller').getConfirmRate(user.id).catch(() => null);

    return res_.success(res, {
      ...formatBuddyProfile(user, { compatibilityScore: compat, distanceKm: distKm, isOnline }),
      confirmRate,
    });
  } catch (e) { next(e); }
};

module.exports = { updateProfile, getBuddyProfile };
