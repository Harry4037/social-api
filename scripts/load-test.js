// ─────────────────────────────────────────────────────────
//  Seshlly API load test (k6) — READ-ONLY endpoints
//
//  Install k6:  https://k6.io/docs/get-started/installation/
//  Run (use STAGING / a copy of prod, not live users):
//
//    k6 run -e BASE_URL=https://staging-api.seshlly.com/api/v1 \
//           -e TOKEN=<access token of a test user> \
//           scripts/load-test.js
//
//  Ramps 0 → 100 → 300 → 500 virtual users over ~9 minutes.
//  Each virtual user behaves like an active app user (opens Discover,
//  chats, feed, notifications) with 1–3s pauses.
//
//  How to read the result:
//   • http_req_failed  should stay < 1%
//   • http_req_duration p(95) should stay < 800ms
//  The VU level where these break = your server's practical limit.
//  Watch server CPU / RAM / MySQL connections while it runs.
// ─────────────────────────────────────────────────────────
import http from 'k6/http';
import { check, sleep, group } from 'k6';

const BASE  = __ENV.BASE_URL || 'http://localhost:5000/api/v1';
const TOKEN = __ENV.TOKEN;
// Optional: a Mumbai-ish location so Discover runs the geo query
const LAT = __ENV.LAT || '19.0760';
const LNG = __ENV.LNG || '72.8777';

export const options = {
  stages: [
    { duration: '1m', target: 100 },
    { duration: '2m', target: 100 },
    { duration: '1m', target: 300 },
    { duration: '2m', target: 300 },
    { duration: '1m', target: 500 },
    { duration: '1m', target: 500 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed:   ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

const params = { headers: { Authorization: `Bearer ${TOKEN}` } };

export function setup() {
  if (!TOKEN) throw new Error('Pass -e TOKEN=<access token of a test user>');
  const r = http.get(`${BASE}/auth/me`, params);
  if (r.status !== 200) throw new Error(`Token check failed: ${r.status} ${r.body}`);
}

export default function () {
  group('discover', () => {
    const r = http.get(`${BASE}/match/discover?lat=${LAT}&lng=${LNG}&maxDistance=10&page=1&limit=20`, params);
    check(r, { 'discover 200': (x) => x.status === 200 });
  });
  sleep(Math.random() * 2 + 1);

  group('chats', () => {
    const r = http.get(`${BASE}/chat`, params);
    check(r, { 'chats 200': (x) => x.status === 200 });
  });
  sleep(Math.random() * 2 + 1);

  group('feed + notifications', () => {
    const responses = http.batch([
      ['GET', `${BASE}/feed`, null, params],
      ['GET', `${BASE}/notifications`, null, params],
      ['GET', `${BASE}/sessions/pending-confirm`, null, params],
      ['GET', `${BASE}/match/boost/status`, null, params],
    ]);
    responses.forEach((r) => check(r, { 'batch 200': (x) => x.status === 200 }));
  });
  sleep(Math.random() * 2 + 1);
}
