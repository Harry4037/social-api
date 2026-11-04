// ─────────────────────────────────────────────────────────
//  challenge.controller.js  (V2 — fixed response envelope)
//
//  All responses now use the standard { success: true, data: {...} }
//  envelope so the Flutter ApiService._data() helper can unwrap them.
//
//  GET /challenges      → { success, data: { challenges: [...] } }
//  GET /challenges/my   → { success, data: { entries: [...] } }
//  GET /challenges/:id  → { success, data: { challenge: {...} } }
//  POST /challenges/:id/join → { success, data: { entry: {...} } }
//  GET /challenges/:id/feed  → { success, data: { posts: [...] } }
//  GET /leaderboard          → { success, data: { entries: [...] } }
// ─────────────────────────────────────────────────────────
'use strict';
const { success, created, error } = require('../utils/response');
const prisma = require('../config/db');

// ── GET /challenges?tier=&type=&city= ─────────────────────
exports.getChallenges = async (req, res) => {
  try {
    const { tier, type, city, environment } = req.query;
    const where = { isActive: true };
    if (tier)        where.tier        = Number(tier);
    if (type)        where.type        = type;
    if (city)        where.cityId      = city;
    if (environment) where.environment = environment;

    const challenges = await prisma.challenge.findMany({
      where,
      include: {
        stations: { orderBy: { stationNum: 'asc' } },
        _count:   { select: { entries: true } },
        entries:  req.user ? {
          where:   { userId: req.user.id },
          include: { completions: true },
          orderBy: { joinedAt: 'desc' },
          take:    1,
        } : false,
      },
      orderBy: [{ tier: 'asc' }, { startAt: 'desc' }],
    });

    const shaped = challenges.map(c => ({
      ...c,
      participantCount: c._count.entries,
      myEntry:          c.entries?.[0] ?? null,
      _count:           undefined,
      entries:          undefined,
    }));

    // ✅ Wrapped in standard envelope so Flutter _data() can unwrap it
    return success(res, { challenges: shaped });
  } catch (err) {
    console.error('[getChallenges]', err);
    return error(res, 'Failed to fetch challenges');
  }
};

// ── GET /challenges/my ────────────────────────────────────
exports.getMyChallenges = async (req, res) => {
  try {
    const entries = await prisma.challengeEntry.findMany({
      where:   { userId: req.user.id },  // all statuses including completed
      include: {
        completions: true,
        challenge: {
          select: {
            id:    true,
            title: true,
            type:  true,
            tier:  true,
            environment: true,
            activityTag: true,
            stations: { orderBy: { stationNum: 'asc' } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    // Flatten challengeTitle to top level for Flutter model
    const formatted = entries.map(e => ({
      ...e,
      challengeTitle: e.challenge?.title ?? null,
    }));

    return success(res, { entries: formatted });
  } catch (err) {
    console.error('[getMyChallenges]', err);
    return error(res, 'Failed to fetch entries');
  }
};

// ── GET /challenges/:id ───────────────────────────────────
exports.getChallenge = async (req, res) => {
  try {
    const challenge = await prisma.challenge.findUnique({
      where: { id: req.params.id },
      include: {
        stations: { orderBy: { stationNum: 'asc' } },
        _count:   { select: { entries: true } },
        entries:  req.user ? {
          where:   { userId: req.user.id },
          include: { completions: true },
          orderBy: { joinedAt: 'desc' },
          take:    1,
        } : false,
      },
    });

    if (!challenge) return error(res, 'Challenge not found', 404);

    const shaped = {
      ...challenge,
      participantCount: challenge._count.entries,
      myEntry:          challenge.entries?.[0] ?? null,
      _count:           undefined,
      entries:          undefined,
    };

    return success(res, { challenge: shaped });
  } catch (err) {
    console.error('[getChallenge]', err);
    return error(res, 'Failed to fetch challenge');
  }
};

// ── POST /challenges/:id/join ─────────────────────────────
exports.joinChallenge = async (req, res) => {
  try {
    const { id }      = req.params;
    const { buddyId } = req.body;

    const challenge = await prisma.challenge.findUnique({ where: { id } });
    if (!challenge || !challenge.isActive)
      return error(res, 'Challenge not found or inactive', 404);

    // Level / trust come from the DB — req.user (auth middleware) doesn't
    // carry them, so before this fix every trust-gated challenge was locked.
    const me = await prisma.user.findUnique({
      where: { id: req.user.id }, select: { level: true, trustScore: true, firstName: true },
    });
    if ((me?.level ?? 1) < (challenge.entryLevelRequired || 1))
      return error(res, `Level ${challenge.entryLevelRequired} required to join`, 403);
    if (Number(me?.trustScore ?? 0) < (challenge.trustRequired || 0))
      return error(res, `Trust score ${challenge.trustRequired}+ required`, 403);

    // Buddy must be an active match
    if (buddyId) {
      const isBuddy = await prisma.match.findFirst({
        where: {
          status: 'active',
          OR: [
            { userAId: req.user.id, userBId: buddyId },
            { userAId: buddyId, userBId: req.user.id },
          ],
        },
        select: { id: true },
      });
      if (!isBuddy) return error(res, 'You can only invite your buddies', 400);
    }

    const existing = await prisma.challengeEntry.findFirst({
      where: { challengeId: id, userId: req.user.id, status: { in: ['active', 'completed'] } },
      select: { id: true, status: true, buddyId: true },
    });
    if (existing?.status === 'completed') return error(res, 'You already completed this challenge', 409);
    // Already in solo → adding a buddy later (unlocks buddy-required stations)
    let entry;
    if (existing && buddyId && !existing.buddyId) {
      entry = await prisma.challengeEntry.update({
        where: { id: existing.id }, data: { buddyId },
        include: { completions: true },
      });
    } else if (existing) {
      return error(res, 'Already enrolled', 409);
    }

    if (!entry) entry = await prisma.challengeEntry.create({
      data: {
        challengeId:    id,
        userId:         req.user.id,
        buddyId:        buddyId ?? null,
        status:         'active',
        currentStation: 1,
        totalXpEarned:  0,
      },
      include: { completions: true },
    });

    // Let the buddy know they were picked
    if (buddyId) {
      try {
        const notifSvc = require('../services/notification.service');
        await notifSvc.create({
          userId: buddyId, type: 'match',
          title: `🏁 ${me?.firstName || 'Your buddy'} picked you for a challenge`,
          message: `${challenge.title} — train together and earn collab XP.`,
          actionUrl: `/challenges/${id}`,
          data: { kind: 'challenge_invite', challengeId: id, fromUserId: req.user.id },
        });
      } catch (_) {}
    }

    return created(res, { entry });
  } catch (err) {
    console.error('[joinChallenge]', err);
    return error(res, 'Failed to join challenge');
  }
};

// ── POST /challenges/:id/proof — complete the current station ──
// Body: { proofImageUrl } (live camera photo) or { sessionId } (uses its proof),
//       optional stationId (must be the current station).
exports.submitStationProof = async (req, res) => {
  try {
    const { id } = req.params;
    const { stationId, sessionId } = req.body;
    let { proofImageUrl } = req.body;

    const entry = await prisma.challengeEntry.findFirst({
      where: { challengeId: id, userId: req.user.id, status: 'active' },
      include: { challenge: { include: { stations: { orderBy: { stationNum: 'asc' } } } } },
    });
    if (!entry) return error(res, 'Join this challenge first', 404);

    const stations = entry.challenge.stations;
    const station = stationId
      ? stations.find(s => s.id === stationId)
      : stations.find(s => s.stationNum === entry.currentStation);
    if (!station) return error(res, 'Station not found', 404);
    if (station.stationNum !== entry.currentStation) {
      return error(res, `Complete station ${entry.currentStation} first`, 409);
    }
    if (station.buddyRequired && !entry.buddyId) {
      return error(res, 'This station needs a buddy — invite one to continue', 400);
    }
    if (new Date(entry.challenge.endAt) < new Date()) {
      return error(res, 'This challenge has ended', 400);
    }

    const { isOwnUpload } = require('../utils/mediaUrl');
    if (proofImageUrl) {
      // A client-supplied photo must ALWAYS be my own fresh upload
      // (sending any sessionId used to skip this check)
      if (!(await isOwnUpload(req.user.id, proofImageUrl, { maxAgeHours: 24, after: entry.joinedAt }))) {
        return error(res, 'Take the proof photo with the in-app camera (after joining the challenge)', 422);
      }
    } else if (sessionId) {
      // Re-use a session's proof only if it's MY recent, finished workout
      const session = await prisma.workoutSession.findFirst({
        where: {
          id: sessionId,
          OR: [{ userId: req.user.id }, { buddyId: req.user.id }],
          proofUploadedBy: req.user.id,
          status: 'completed',
          proofUploadedAt: { gte: new Date(Date.now() - 24 * 3600e3) },
        },
        select: { proofImageUrl: true },
      });
      if (!session) return error(res, 'Use a workout you finished in the last 24 hours', 422);
      proofImageUrl = session.proofImageUrl || null;
    }
    if (!proofImageUrl) return error(res, 'Proof photo required', 422);
    // Each photo is used only once
    const reused = await prisma.stationCompletion.findFirst({
      where: { proofImageUrl, entry: { userId: req.user.id } }, select: { id: true },
    });
    if (reused) return error(res, 'This photo was already used — take a new one', 409);

    // AI fake-photo check (only when configured)
    if (process.env.HIVE_API_KEY) {
      const { checkProofImage } = require('./verification.controller');
      const ai = await checkProofImage(proofImageUrl);
      if (!ai.valid) return error(res, ai.reason || 'Proof photo rejected', 422);
    }

    const isLast = station.stationNum >= stations.length;
    const xp = station.xpReward || 0;
    // Atomic claim: only ONE request can move the entry past this station
    // (two quick taps used to create two completions and pay XP twice)
    const claim = await prisma.challengeEntry.updateMany({
      where: { id: entry.id, status: 'active', currentStation: station.stationNum },
      data: {
        currentStation: station.stationNum + 1,
        totalXpEarned:  { increment: xp },
        lastSessionAt:  new Date(),
        ...(isLast && { status: 'completed', completedAt: new Date() }),
      },
    });
    if (claim.count === 0) return error(res, 'This station is already done', 409);
    const completion = await prisma.stationCompletion.create({
      data: {
        entryId: entry.id, stationId: station.id, stationNum: station.stationNum,
        xpAwarded: xp, isCollab: false, progressValue: station.targetValue || 1,
        proofImageUrl,
      },
    });

    const xpCtrl = require('./xp.controller');
    if (xp > 0) await xpCtrl.awardXP(req.user.id, xp, 'challenge_station', { challengeId: id, stationNum: station.stationNum });

    try {
      const notifSvc = require('../services/notification.service');
      await notifSvc.create({
        userId: req.user.id, type: 'xp', push: false,
        title: isLast ? `🏆 ${entry.challenge.title} complete!` : `✅ Station ${station.stationNum} done`,
        message: isLast ? `You finished every station. +${xp} XP` : `+${xp} XP · Station ${station.stationNum + 1} unlocked`,
        data: { challengeId: id },
      });
    } catch (_) {}

    return created(res, {
      completion,
      stationCompletionId: completion.id,
      stationNum: station.stationNum,
      stationTitle: station.title,
      xpAwarded: xp,
      proofImageUrl,
      challengeCompleted: isLast,
      nextStation: isLast ? null : station.stationNum + 1,
    });
  } catch (err) {
    console.error('[submitStationProof]', err);
    return error(res, 'Failed to submit proof');
  }
};

// ── POST /challenges/:id/collab — buddy joins a station completion ──
// Marks it as a collab and gives both people a small bonus (once).
exports.addCollab = async (req, res) => {
  try {
    const { stationCompletionId } = req.body;
    const completion = await prisma.stationCompletion.findUnique({
      where: { id: stationCompletionId },
      include: { entry: true },
    });
    if (!completion || completion.entry.challengeId !== req.params.id)
      return error(res, 'Completion not found', 404);
    const { entry } = completion;
    if (entry.buddyId !== req.user.id && entry.userId !== req.user.id)
      return error(res, 'Only the challenge buddy can collab', 403);
    if (!entry.buddyId) return error(res, 'Add a buddy to this challenge first', 400);
    // Atomic: the bonus is paid once per completion (it was claimable in a loop)
    const claim = await prisma.stationCompletion.updateMany({
      where: { id: completion.id, isCollab: false }, data: { isCollab: true },
    });
    if (claim.count === 0) return success(res, { collab: true }, 'Already a collab');
    const xpCtrl = require('./xp.controller');
    const BONUS = 10;
    for (const uid of [entry.userId, entry.buddyId].filter(Boolean)) {
      await xpCtrl.awardXP(uid, BONUS, 'challenge_collab', { completionId: completion.id });
    }
    return success(res, { collab: true, bonusXp: BONUS }, 'Collab badge earned!');
  } catch (err) {
    console.error('[addCollab]', err);
    return error(res, 'Failed to add collab');
  }
};

// ── GET /challenges/:id/feed ──────────────────────────────
exports.getChallengeFeed = async (req, res) => {
  try {
    const { page, limit } = require('../utils/paging').pageParams(req.query, { def: 20, max: 50 });

    const posts = await prisma.challengeFeedPost.findMany({
      // feed posts live 24h
      where:   {
        challengeId: req.params.id, expiresAt: { gt: new Date() },
        user: { status: 'ACTIVE', isBanned: false, ...require('./safety.controller').notBlockedWhere(req.user.id) },
      },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { postedAt: 'desc' },
      skip:    (Number(page) - 1) * Number(limit),
      take:    Number(limit),
    });

    const shaped = posts.map(p => ({
      ...p,
      displayName: `${p.user.firstName} ${p.user.lastName}`,
      avatarUrl:   p.user.avatarUrl,
      user:        undefined,
    }));

    return success(res, { posts: shaped });
  } catch (err) {
    console.error('[getChallengeFeed]', err);
    return error(res, 'Failed to fetch feed');
  }
};

// ── GET /leaderboard?challengeId=&city= ──────────────────
exports.getLeaderboard = async (req, res) => {
  try {
    const { challengeId, city } = req.query;

    const { notBlockedWhere } = require('./safety.controller');
    const where = { status: { in: ['active', 'completed'] } };
    if (challengeId) where.challengeId = challengeId;
    // Hidden profiles, banned users and blocks are respected on leaderboards
    where.user = {
      status: 'ACTIVE', isBanned: false, profileVisibility: 'public',
      ...notBlockedWhere(req.user.id),
      // City filter in the DB (was applied after take:50 → missing people)
      ...(city && { city }),
    };

    const entries = await prisma.challengeEntry.findMany({
      where,
      include: {
        user:  { select: { id: true, firstName: true, lastName: true, avatarUrl: true, city: true } },
        buddy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ totalXpEarned: 'desc' }, { currentStation: 'desc' }],
      take:    50,
    });

    const board = entries.map((e, i) => ({
      rank:              i + 1,
      userId:            e.userId,
      displayName:       `${e.user.firstName} ${e.user.lastName}`,
      avatarUrl:         e.user.avatarUrl,
      city:              e.user.city,
      buddyName:         e.buddy ? `${e.buddy.firstName} ${e.buddy.lastName}` : null,
      xpEarned:          e.totalXpEarned,
      stationsCompleted: Math.max(0, e.currentStation - 1),
    }));

    return success(res, { entries: board });
  } catch (err) {
    console.error('[getLeaderboard]', err);
    return error(res, 'Failed to fetch leaderboard');
  }
};

// ── GET /global-leaderboard?period=weekly|monthly|alltime&city= ──
// Weekly / monthly rank by weeklyXp / monthlyXp (reset by cron).
// Previously every tab ranked by all-time XP, so the tabs looked identical.
// If I'm not in the top 100, my own row is appended with my real rank.
// Top list cache (per instance). Same for everyone → no need to sort the
// whole users table on every open (load test: p95 28 s at 1000 users).
// Blocks, hidden profiles and "my" row are still applied per request.
const _lbCache = new Map(); // `${period}|${city}` → { at, users }
const LB_TTL = () => Number(process.env.LEADERBOARD_CACHE_MS ?? 30000);
exports._clearLeaderboardCache = () => _lbCache.clear();

exports.getGlobalLeaderboard = async (req, res) => {
  try {
    const { period = 'alltime', city } = req.query;
    const xpField = period === 'weekly' ? 'weeklyXp'
                  : period === 'monthly' ? 'monthlyXp'
                  : 'xpTotal';
    const myId = req.user.id;

    const publicWhere = {
      status:   'ACTIVE',
      isBanned: false,
      profileVisibility: 'public',          // "Hidden" means hidden here too
      ...(city && { city }),
    };
    const select = {
      id: true, firstName: true, lastName: true, avatarUrl: true,
      city: true, xpTotal: true, weeklyXp: true, monthlyXp: true,
      level: true, primaryActivity: true, profileVisibility: true, status: true, isBanned: true,
    };

    const key = `${xpField}|${city || ''}`;
    let hit = _lbCache.get(key);
    if (!hit || Date.now() - hit.at > LB_TTL()) {
      const users = await prisma.user.findMany({
        where:   { ...publicWhere, [xpField]: { gt: 0 } },
        select,
        orderBy: [{ [xpField]: 'desc' }, { xpTotal: 'desc' }],
        take:    150, // spare rows for people filtered out by blocks
      });
      hit = { at: Date.now(), users };
      if (LB_TTL() > 0) _lbCache.set(key, hit);
    }

    const { blockedIdsFor } = require('./safety.controller');
    const blocked = await blockedIdsFor(myId); // both directions
    const me = await prisma.user.findUnique({ where: { id: myId }, select });
    const meListed = me && me.status === 'ACTIVE' && !me.isBanned &&
      me.profileVisibility === 'public' && (!city || me.city === city) && me[xpField] > 0;

    const cmp = (a, b) => (b[xpField] - a[xpField]) || (b.xpTotal - a.xpTotal);
    const list = hit.users.filter(u => u.id !== myId && !blocked.has(u.id));
    if (meListed) list.push(me);   // my row is always fresh
    list.sort(cmp);

    const toEntry = (u, rank) => ({
      rank,
      userId:          u.id,
      displayName:     `${u.firstName} ${u.lastName}`,
      avatarUrl:       u.avatarUrl,
      city:            u.city,
      xpTotal:         u[xpField],   // XP for the selected period (app shows "X XP")
      allTimeXp:       u.xpTotal,
      level:           u.level,
      primaryActivity: u.primaryActivity,
    });

    const board = list.slice(0, 100).map((u, i) => toEntry(u, i + 1));

    // My rank, even outside the top 100
    let myRank = null;
    const mine = board.find(e => e.userId === myId);
    if (mine) {
      myRank = mine.rank;
    } else if (me && (!city || me.city === city)) {
      const ahead = await prisma.user.count({
        where: { ...publicWhere, [xpField]: { gt: me[xpField] } },
      });
      myRank = ahead + 1;
      board.push(toEntry(me, myRank));
    }

    return success(res, { entries: board, period, city: city || null, myRank });
  } catch (err) {
    console.error('[getGlobalLeaderboard]', err);
    return error(res, 'Failed to fetch global leaderboard');
  }
};

// ── GET /feed — Global challenge feed (last 24hrs) ────────
exports.getGlobalFeed = async (req, res) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const { notBlockedWhere } = require('./safety.controller');
    const posts = await prisma.challengeFeedPost.findMany({
      where: {
        expiresAt: { gt: new Date() },
        user: { status: 'ACTIVE', isBanned: false, ...notBlockedWhere(req.user.id) },
      },
      include: {
        user:      { select: { id:true, firstName:true, lastName:true, avatarUrl:true, city:true } },
        challenge: { select: { id:true, title:true, activityTag:true } },
      },
      orderBy: { postedAt: 'desc' },
      take: 50,
    });

    const formatted = posts.map(p => ({
      id:             p.id,
      userId:         p.userId,
      displayName:    `${p.user.firstName} ${p.user.lastName}`,
      avatarUrl:      p.user.avatarUrl,
      city:           p.user.city,
      challengeId:    p.challengeId,
      challengeTitle: p.challenge.title,
      activityTag:    p.challenge.activityTag,
      stationNum:     p.stationNum,
      stationTitle:   p.stationTitle,
      postedAt:       p.postedAt,
      expiresAt:      p.expiresAt,
      xpAwarded:      p.xpAwarded,
      proofImageUrl:  p.proofImageUrl,
      isCollab:       p.isCollab,
      collabUserName: p.collabUserName,
      collabAvatarUrl:p.collabAvatarUrl,
      caption:        p.caption,
      groupPhotoUrl:  p.groupPhotoUrl,
      groupName:      p.groupName,
    }));

    return success(res, { posts: formatted, count: formatted.length });
  } catch (err) {
    console.error('[getGlobalFeed]', err);
    return error(res, 'Failed to fetch feed');
  }
};

// ── POST /feed — Post to global feed after session/challenge ─
exports.postToFeed = async (req, res) => {
  // Everything that matters on a post comes from the server: XP, station,
  // proof photo and collab partner. The client only chooses to share and
  // may add a caption. (Before, anyone could post a fake workout, any image
  // URL, or put another person's name on the post.)
  try {
    const { challengeId, stationCompletionId, sessionId, caption, activitySlug, groupName } = req.body;
    const { isAllowedMediaUrl } = require('../utils/mediaUrl');
    const me = req.user.id;

    const challenge = await prisma.challenge.findUnique({ where: { id: challengeId }, select: { id: true } });
    if (!challenge) return error(res, 'Only challenge workouts can be posted to the feed', 400);
    if (!stationCompletionId && !sessionId) {
      return error(res, 'Complete a station or a session before posting', 400);
    }

    let serverXp = 0, stationNum = 0, stationTitle = null, proofImageUrl = null, partnerId = null;

    if (stationCompletionId) {
      const c = await prisma.stationCompletion.findUnique({
        where: { id: stationCompletionId },
        include: { entry: true, station: { select: { title: true } } },
      });
      if (!c || c.entry.challengeId !== challengeId) return error(res, 'Station completion not found', 404);
      if (c.entry.userId !== me && c.entry.buddyId !== me) return error(res, 'Not your workout', 403);
      serverXp     = c.xpAwarded;
      stationNum   = c.stationNum;
      stationTitle = c.station?.title || 'Station';
      partnerId    = c.entry.userId === me ? c.entry.buddyId : c.entry.userId;
      // The station's own live photo (stored on completion); older rows → client URL
      proofImageUrl = c.proofImageUrl || req.body.proofImageUrl || null;
    } else {
      const session = await prisma.workoutSession.findFirst({
        where: { id: sessionId, OR: [{ userId: me }, { buddyId: me }] },
        include: { participants: true },
      });
      if (!session || !session.proofImageUrl) return error(res, 'Upload your session proof first', 400);
      serverXp = session.xpEarned
        // buddy session still awaiting confirm → show what it will earn
        ?? (session.buddyId
          ? require('./xp.controller').calcSessionXP(session, (session.participants?.length || 0) + 2) + 20
          : 50);
      stationNum    = Number(req.body.stationNum) || 0;
      stationTitle  = (req.body.stationTitle || session.activity || 'Workout').toString().slice(0, 120);
      proofImageUrl = session.proofImageUrl;
      partnerId     = session.userId === me ? session.buddyId : session.userId;
    }

    if (proofImageUrl && !isAllowedMediaUrl(proofImageUrl)) {
      return error(res, 'Image must be uploaded through the app', 422);
    }
    const groupPhotoUrl = req.body.groupPhotoUrl || null;
    if (groupPhotoUrl && !isAllowedMediaUrl(groupPhotoUrl)) {
      return error(res, 'Image must be uploaded through the app', 422);
    }

    // One post per workout (24h feed)
    const dup = await prisma.challengeFeedPost.findFirst({
      where: { userId: me, challengeId, stationNum, stationTitle, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (dup) return error(res, 'You already shared this workout', 409);

    let partner = null;
    if (partnerId) {
      partner = await prisma.user.findUnique({
        where: { id: partnerId }, select: { id: true, firstName: true, lastName: true, avatarUrl: true },
      });
    }

    const now       = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24h

    const post = await prisma.challengeFeedPost.create({
      data: {
        challengeId,
        userId:          me,
        stationNum,
        stationTitle,
        xpAwarded:       serverXp, // client-sent xpAwarded is ignored
        proofImageUrl,
        isCollab:        !!partner,
        collabUserId:    partner?.id ?? null,
        collabUserName:  partner ? `${partner.firstName} ${partner.lastName}`.trim() : null,
        collabAvatarUrl: partner?.avatarUrl ?? null,
        activitySlug:    activitySlug ? String(activitySlug).slice(0, 40) : null,
        caption:         caption ? String(caption).slice(0, 300) : null,
        groupPhotoUrl,
        groupName:       groupName ? String(groupName).slice(0, 60) : null,
        postedAt:  now,
        expiresAt,
      },
    });

    return created(res, { post }, 'Posted to feed');
  } catch (err) {
    console.error('[postToFeed]', err);
    return error(res, 'Failed to post to feed');
  }
};
