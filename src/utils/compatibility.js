'use strict';

/**
 * Computes a 0–100 compatibility score between two users.
 * Weights: activity (40%) + level (25%) + goals (25%) + distance (10%)
 */
const computeCompatibility = (user, candidate) => {
  let score = 0;

  // ── Activity match (40 pts) ───────────────────────────
  if (user.primaryActivity && candidate.primaryActivity &&
      user.primaryActivity === candidate.primaryActivity) {
    score += 40;
  } else {
    const uActs = Array.isArray(user.activities)
      ? user.activities
      : JSON.parse(user.activities || '[]');
    const cActs = Array.isArray(candidate.activities)
      ? candidate.activities
      : JSON.parse(candidate.activities || '[]');
    const shared = uActs.filter(a => cActs.includes(a));
    if (shared.length > 0) score += 20 + Math.min(shared.length - 1, 2) * 5;
  }

  // ── Level proximity (25 pts) ──────────────────────────
  const diff = Math.abs((user.level || 1) - (candidate.level || 1));
  if      (diff === 0) score += 25;
  else if (diff === 1) score += 15;
  else if (diff === 2) score += 8;

  // ── Goal overlap (25 pts) ─────────────────────────────
  const uGoals = Array.isArray(user.goals)
    ? user.goals
    : JSON.parse(user.goals || '[]');
  const cGoals = Array.isArray(candidate.goals)
    ? candidate.goals
    : JSON.parse(candidate.goals || '[]');
  const sharedGoals = uGoals.filter(g => cGoals.includes(g));
  score += Math.min(sharedGoals.length * 8, 25);

  // ── Distance (10 pts) ─────────────────────────────────
  if (user.latitude && user.longitude && candidate.latitude && candidate.longitude) {
    const km = haversine(
      Number(user.latitude), Number(user.longitude),
      Number(candidate.latitude), Number(candidate.longitude),
    );
    if      (km < 2)  score += 10;
    else if (km < 5)  score += 8;
    else if (km < 10) score += 5;
    else if (km < 20) score += 3;
  }

  return Math.min(Math.round(score), 100);
};

const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const deg2rad = (d) => d * (Math.PI / 180);

module.exports = { computeCompatibility, haversine };
