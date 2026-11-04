'use strict';
// ─────────────────────────────────────────────────────────
//  Counts for a PAGE of users, without Prisma's `_count`.
//
//  Prisma turns `_count: { select: { matchesA: true } }` into
//  LEFT JOIN (SELECT userAId, COUNT(*) FROM matches GROUP BY userAId) — a
//  scan of the whole table on every request. The 1000-user load test showed
//  it on /auth/me, Discover, buddies and the chat list. These helpers count
//  only the rows of the users / chats on the page (indexed `IN (…)`).
//
//  Result keeps the old shape (u._count.matchesA / sessionsAsUser) so the
//  formatters don't change. Meaning (fixed): buddies = active matches on
//  EITHER side; sessions = completed sessions as host or buddy.
// ─────────────────────────────────────────────────────────
const prisma = require('../config/db');

const tally = (rows, key, into) => {
  for (const r of rows) {
    const id = r[key];
    if (into.has(id)) into.set(id, into.get(id) + (r._count?._all ?? r._count ?? 0));
  }
};

const withUserCounts = async (users, { challenges = false } = {}) => {
  const list = (users || []).filter(Boolean);
  const ids = [...new Set(list.map(u => u.id))];
  if (!ids.length) return list;
  const zero = () => new Map(ids.map(id => [id, 0]));
  const buddies = zero(), sessions = zero(), entries = zero();
  const [mA, mB, sU, sB, ce] = await Promise.all([
    prisma.match.groupBy({ by: ['userAId'], where: { userAId: { in: ids }, status: 'active' }, _count: { _all: true } }),
    prisma.match.groupBy({ by: ['userBId'], where: { userBId: { in: ids }, status: 'active' }, _count: { _all: true } }),
    prisma.workoutSession.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: 'completed' }, _count: { _all: true } }),
    prisma.workoutSession.groupBy({ by: ['buddyId'], where: { buddyId: { in: ids }, status: 'completed' }, _count: { _all: true } }),
    challenges
      ? prisma.challengeEntry.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);
  tally(mA, 'userAId', buddies); tally(mB, 'userBId', buddies);
  tally(sU, 'userId', sessions); tally(sB, 'buddyId', sessions);
  tally(ce, 'userId', entries);
  for (const u of list) {
    u._count = { matchesA: buddies.get(u.id), sessionsAsUser: sessions.get(u.id) };
    if (challenges) u._count.challengeEntries = entries.get(u.id);
  }
  return list;
};

const withUserCount = async (user, opts) => (user ? (await withUserCounts([user], opts))[0] : user);

module.exports = { withUserCounts, withUserCount };
