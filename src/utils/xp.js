'use strict';

const THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3000, 4000, 5500];
const LEVEL_NAMES = ['Newbie','Rookie','Regular','Athlete','Pro','Elite','Champion','Legend','Icon','GOAT'];

const XP_REWARDS = {
  session_uploaded:  50,
  buddy_matched:     30,
  streak_7:         100,
  streak_30:        500,
  profile_complete:  25,
  first_checkin:     20,
};

const levelFromXp = (xp) => {
  let level = 1;
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= THRESHOLDS[i]) { level = i + 1; break; }
  }
  return Math.min(level, THRESHOLDS.length);
};

const levelName = (level) =>
  LEVEL_NAMES[Math.min(level - 1, LEVEL_NAMES.length - 1)];

const xpForAction = (action) => XP_REWARDS[action] ?? 0;

module.exports = { levelFromXp, levelName, xpForAction, THRESHOLDS, LEVEL_NAMES };
