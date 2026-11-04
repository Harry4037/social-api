// ─────────────────────────────────────────────────────────
//  Full-flow simulation of N app users (default 1000) against a STAGING API.
//  Every virtual user: sign up → profile → socket → Discover → likes →
//  match → chat → schedule (pairs + groups of 3) → invite confirm →
//  "On my way" → proof → buddy confirms → every tab → 60 s mixed traffic.
//  Prints latency (p50/p95/p99) + errors per endpoint; JSON saved next to it.
//
//  NEVER against production — it creates 1000 fake accounts.
//
//    LOADTEST_CONFIRM=yes BASE_URL=http://staging:5000 \
//    DATABASE_URL=mysql://…/seshlly_staging  node scripts/loadtest/sim.js 1000
//
//  DB access is used only to (a) make time pass (move sessions into the
//  past so proof can be uploaded) and (b) record proof uploads (normally done
//  by POST /upload → Cloudinary). Needs: npm i -D socket.io-client
//  Server must trust X-Forwarded-For (TRUST_PROXY=1) so each user has an IP.
// ─────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

if (process.env.LOADTEST_CONFIRM !== 'yes') {
  console.error('Set LOADTEST_CONFIRM=yes (and point BASE_URL / DATABASE_URL at STAGING).');
  process.exit(1);
}
if (/prod/i.test(process.env.DATABASE_URL || '') || /prod/i.test(process.env.BASE_URL || '')) {
  console.error('Refusing: looks like production.'); process.exit(1);
}
const N = Number(process.argv[2] || 1000);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const API = BASE + '/api/v1';
const RUN = Date.now().toString(36);
const CLOUD = process.env.CLOUDINARY_CLOUD_NAME || 'demo';
const OUT = path.join(process.cwd(), `loadtest-result-${N}.json`);

// direct DB (only for "time passes" + upload rows, which need Cloudinary)
const prisma = require('../../src/config/db');

// ── stats ────────────────────────────────────────────────
const stats = {};       // key → { n, ms[], codes{}, errors{} }
const phaseTimes = {};
const norm = (method, url) => method + ' ' + url.replace(API, '').split('?')[0]
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ':id');
function record(key, ms, code, body) {
  const s = (stats[key] ||= { n: 0, ms: [], codes: {}, errors: {} });
  s.n++; s.ms.push(ms); s.codes[code] = (s.codes[code] || 0) + 1;
  if (code >= 400 || code === 0) {
    const msg = `${code} ${(body && (body.message || body.error)) || ''}`.slice(0, 120);
    s.errors[msg] = (s.errors[msg] || 0) + 1;
  }
}
async function req(vu, method, url, body) {
  const t = performance.now();
  let code = 0, json = null;
  try {
    const r = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': vu.ip,
        ...(vu.token && { authorization: `Bearer ${vu.token}` }),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    code = r.status;
    json = await r.json().catch(() => null);
  } catch (e) {
    json = { message: e.name === 'TimeoutError' ? 'client timeout 30s' : e.message };
  }
  record(norm(method, url), performance.now() - t, code, json);
  return { code, json };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (max) => sleep(Math.random() * max);
async function phase(name, fn) {
  const t = Date.now();
  process.stdout.write(`▶ ${name} … `);
  await fn();
  phaseTimes[name] = Date.now() - t;
  console.log(`${(phaseTimes[name] / 1000).toFixed(1)} s`);
}
const all = (fn) => Promise.all(vus.map((v, i) => fn(v, i)));

// ── health probe (how responsive is the server for everyone else?) ──
const health = [];
let probing = true;
(async () => {
  while (probing) {
    const t = performance.now();
    try { await fetch(BASE + '/health', { signal: AbortSignal.timeout(30000) }); } catch {}
    health.push({ t: Date.now(), ms: performance.now() - t });
    await sleep(250);
  }
})();

// ── virtual users ────────────────────────────────────────
const ACTS = ['gym', 'running', 'yoga', 'crossfit', 'cycling'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const vus = Array.from({ length: N }, (_, i) => ({
  i, ip: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`,
  email: `vu${i}_${RUN}@load.seshlly.com`, token: null, id: null,
  matches: [], chats: [], sockets: null, got: 0,
}));
// buddy plan: 0..299 → triads (group sessions), rest → pairs
const TRIADS = Math.min(300, N - (N % 3));
const buddiesOf = (i) => i < TRIADS
  ? [0, 1, 2].map(k => i - (i % 3) + k).filter(j => j !== i)
  : [(i - TRIADS) % 2 === 0 ? i + 1 : i - 1].filter(j => j < N);

(async () => {
  const t0 = Date.now();

  await phase('1. Sign up (all at once)', () => all(async (v) => {
    await jitter(2000);
    const r = await req(v, 'POST', `${API}/auth/register`, {
      email: v.email, password: 'Seshlly@2026', firstName: `Vu${v.i}`, lastName: 'Load' });
    if (r.code === 201 && r.json?.data) { v.token = r.json.data.accessToken; v.id = r.json.data.user.id; }
  }));
  const ok = () => vus.filter(v => v.token);
  console.log(`   signed up: ${ok().length}/${N}`);

  await phase('2. Onboarding profile + /auth/me', () => all(async (v) => {
    if (!v.token) return;
    await jitter(1000);
    await req(v, 'PUT', `${API}/users/me`, {
      city: 'Noida', latitude: 28.53 + Math.random() * 0.06, longitude: 77.36 + Math.random() * 0.06,
      primaryActivity: ACTS[v.i % 5], activities: [ACTS[v.i % 5], ACTS[(v.i + 1) % 5]],
      experienceLevel: LEVELS[v.i % 3], goals: ['strength'], gender: v.i % 2 ? 'female' : 'male',
      bio: 'Load test user', walkthroughSeen: true,
    });
    await req(v, 'GET', `${API}/auth/me`);
  }));

  await phase('3. Socket connect (1 per user)', async () => {
    await all(async (v) => {
      if (!v.token) return;
      await jitter(1500);
      const t = performance.now();
      await new Promise((resolve) => {
        const s = io(BASE, { auth: { token: v.token }, transports: ['websocket'], reconnection: false, timeout: 20000 });
        v.socket = s;
        s.on('message:new', () => { v.got++; });
        s.on('connect', () => { record('SOCKET connect', performance.now() - t, 101); resolve(); });
        s.on('connect_error', (e) => { record('SOCKET connect', performance.now() - t, 0, { message: e.message }); resolve(); });
      });
    });
  });

  await phase('4. Discover (2 pages)', () => all(async (v) => {
    if (!v.token) return;
    await jitter(1000);
    const r = await req(v, 'GET', `${API}/match/discover?page=1&limit=20`);
    v.deck = (r.json?.data || []).map(p => p.id);
    await req(v, 'GET', `${API}/match/discover?page=2&limit=20`);
  }));

  await phase('5. Likes → matches', async () => {
    // likes to planned buddies first (mutual → match), then a few random
    await all(async (v) => {
      if (!v.token) return;
      await jitter(1500);
      for (const j of buddiesOf(v.i)) {
        if (!vus[j].id) continue;
        const r = await req(v, 'POST', `${API}/match/like`, { targetUserId: vus[j].id });
        if (r.json?.data?.matched) v.matches.push({ j, chatId: r.json.data.chatId });
      }
      const pick = (v.deck || []).filter(id => !buddiesOf(v.i).some(j => vus[j].id === id)).slice(0, 2);
      for (const id of pick) await req(v, 'POST', `${API}/match/like`, { targetUserId: id });
    });
    // the 6th like of the day must be refused (free plan = 5)
    const v = ok()[0];
    for (let k = 0; k < 6; k++) await req(v, 'POST', `${API}/match/like`, { targetUserId: vus[(v.i + 500 + k) % N].id });
  });

  await phase('6. Chat: list, join rooms, 3 messages each, read', async () => {
    await all(async (v) => {
      if (!v.token) return;
      await jitter(1000);
      const r = await req(v, 'GET', `${API}/chat`);
      v.chats = (r.json?.data || []).map(c => c.id);
      for (const c of v.chats) v.socket?.emit('chat:join', { chatId: c });
    });
    await sleep(1000);
    await all(async (v) => {
      if (!v.token || !v.chats.length) return;
      await jitter(2000);
      for (let k = 0; k < 3; k++) {
        await req(v, 'POST', `${API}/chat/${v.chats[0]}/messages`, { content: `hey ${k} from ${v.i}` });
      }
      await req(v, 'GET', `${API}/chat/${v.chats[0]}/messages?page=1`);
      await req(v, 'PATCH', `${API}/chat/${v.chats[0]}/read`);
    });
    await sleep(2000);
  });

  const sessions = []; // { host, sessionId, members[] }
  await phase('7. Schedule sessions (pairs + groups of 3) + invitees confirm', async () => {
    const when = new Date(Date.now() + 26 * 3600e3);
    when.setUTCMinutes(0, 0, 0);
    await all(async (v) => {
      if (!v.token) return;
      const isHost = v.i < TRIADS ? v.i % 3 === 0 : (v.i - TRIADS) % 2 === 0;
      if (!isHost) return;
      await jitter(1500);
      const ids = buddiesOf(v.i).map(j => vus[j].id).filter(Boolean);
      if (!ids.length) return;
      const r = await req(v, 'POST', `${API}/sessions`, {
        activity: ACTS[v.i % 5], scheduledAt: when.toISOString(), durationMins: 60,
        gymName: 'Iron Paradise Gym', buddyIds: ids });
      if (r.code === 201 && r.json?.data) sessions.push({ host: v.i, sessionId: r.json.data.id, members: buddiesOf(v.i) });
    });
    await all(async (v) => {
      if (!v.token) return;
      await jitter(1500);
      const r = await req(v, 'GET', `${API}/sessions/my?status=scheduled`);
      for (const s of (r.json?.data?.sessions || [])) {
        if (s.userId !== v.id && s.inviteStatus === 'pending') {
          await req(v, 'POST', `${API}/sessions/${s.id}/respond`, { action: 'confirm' });
        }
      }
    });
  });
  console.log(`   sessions created: ${sessions.length}`);

  await phase('8. (time passes) On my way, proof, buddy confirms', async () => {
    // jump the clock: sessions started 20 min ago
    const ids = sessions.map(s => s.sessionId);
    const start = new Date(Date.now() - 20 * 60e3);
    await prisma.workoutSession.updateMany({ where: { id: { in: ids } },
      data: { scheduledAt: start, endTime: new Date(start.getTime() + 60 * 60e3) } });
    await all(async (v) => {
      if (!v.token) return;
      const mine = sessions.filter(s => s.host === v.i || s.members.includes(v.i));
      for (const s of mine) { await jitter(800); await req(v, 'POST', `${API}/sessions/${s.sessionId}/on-my-way`); }
    });
    // host uploads proof (upload row = what POST /upload records after Cloudinary)
    await Promise.all(sessions.map(async (s) => {
      const v = vus[s.host];
      const url = `https://res.cloudinary.com/${CLOUD}/image/upload/proofs/${s.sessionId}.jpg`;
      await prisma.upload.create({ data: { userId: v.id, folder: 'proofs', filename: `${s.sessionId}.jpg`, url } });
      s.url = url;
    }));
    // … session is over now (ended 10 min ago) → proof window open
    const st2 = new Date(Date.now() - 70 * 60e3);
    await prisma.workoutSession.updateMany({ where: { id: { in: ids } },
      data: { scheduledAt: st2, endTime: new Date(st2.getTime() + 60 * 60e3) } });
    await Promise.all(sessions.map(async (s) => {
      const v = vus[s.host];
      await jitter(1500);
      await req(v, 'POST', `${API}/sessions/${s.sessionId}/proof`, { proofImageUrl: s.url });
    }));
    await all(async (v) => {
      if (!v.token) return;
      await jitter(1500);
      const r = await req(v, 'GET', `${API}/sessions/pending-confirm`);
      for (const p of (r.json?.data?.sessions || [])) {
        await req(v, 'POST', `${API}/sessions/${p.sessionId || p.id}/confirm`);
      }
    });
  });

  const READS = [
    'global-leaderboard', 'leaderboard?period=weekly', 'feed?page=1', 'notifications?page=1',
    'flash/streaks', 'challenges', 'referral/my-code', 'strikes/pending', 'match/boost/status',
    'match/buddies', 'chat', 'sessions/my', 'gyms/nearby?lat=28.55&lng=77.38', 'match/requests',
    'brand-ads/active', 'auth/me', 'match/discover',
  ];
  await phase('9. Browse every tab once', () => all(async (v) => {
    if (!v.token) return;
    for (const p of READS) { await jitter(300); await req(v, 'GET', `${API}/${p}`); }
  }));

  const STEADY_S = Number(process.env.STEADY_S || 60);
  let steadyReqs = 0;
  await phase(`10. Steady mixed traffic ${STEADY_S}s (each user ~1 req / 3 s)`, async () => {
    const end = Date.now() + STEADY_S * 1000;
    await all(async (v) => {
      if (!v.token) return;
      await jitter(3000);
      while (Date.now() < end) {
        const roll = Math.random();
        if (roll < 0.15 && v.chats.length) {
          await req(v, 'POST', `${API}/chat/${v.chats[0]}/messages`, { content: 'steady ping' });
        } else if (roll < 0.35 && v.chats.length) {
          await req(v, 'GET', `${API}/chat/${v.chats[0]}/messages?page=1`);
        } else {
          await req(v, 'GET', `${API}/${READS[Math.floor(Math.random() * READS.length)]}`);
        }
        steadyReqs++;
        await sleep(1500 + Math.random() * 3000);
      }
    });
  });

  probing = false;
  const sockets = vus.filter(v => v.socket?.connected).length;
  const delivered = vus.reduce((a, v) => a + v.got, 0);
  vus.forEach(v => v.socket?.close());

  // ── summarise ──
  const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
  const rows = Object.entries(stats).map(([k, s]) => ({
    endpoint: k, n: s.n,
    ok: Object.entries(s.codes).filter(([c]) => c >= 101 && c < 400).reduce((a, [, n]) => a + n, 0),
    p50: Math.round(pct(s.ms, 50)), p95: Math.round(pct(s.ms, 95)), p99: Math.round(pct(s.ms, 99)),
    max: Math.round(Math.max(...s.ms)), codes: s.codes, errors: s.errors,
  })).sort((a, b) => b.p95 - a.p95);
  const db = {
    users: await prisma.user.count(), matches: await prisma.match.count(),
    messages: await prisma.message.count(), sessions: await prisma.workoutSession.groupBy({ by: ['status'], _count: true }),
    notifications: await prisma.notification.count(),
  };
  const result = {
    N, totalSeconds: (Date.now() - t0) / 1000, phaseTimes, sockets, socketMessagesDelivered: delivered,
    steadyReqs, steadyRps: steadyReqs / STEADY_S,
    health: { p50: Math.round(pct(health.map(h => h.ms), 50)), p95: Math.round(pct(health.map(h => h.ms), 95)), max: Math.round(Math.max(...health.map(h => h.ms))) },
    healthTimeline: health, db, rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log(`\nsockets connected at end: ${sockets}, socket messages delivered: ${delivered}`);
  console.log(`health p50/p95/max: ${result.health.p50}/${result.health.p95}/${result.health.max} ms`);
  console.log('endpoint'.padEnd(44), 'n'.padStart(5), 'ok'.padStart(5), 'p50'.padStart(6), 'p95'.padStart(6), 'p99'.padStart(6), ' errors');
  for (const r of rows) {
    console.log(r.endpoint.slice(0, 44).padEnd(44), String(r.n).padStart(5), String(r.ok).padStart(5),
      String(r.p50).padStart(6), String(r.p95).padStart(6), String(r.p99).padStart(6), ' ', JSON.stringify(r.errors).slice(0, 160));
  }
  console.log('DB:', JSON.stringify(db));
  await prisma.$disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
