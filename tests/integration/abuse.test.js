'use strict';
// Pen-test findings: ways to farm XP / tokens / plans, bypass paywalls,
// stalk locations and forge chat cards. Each test = one exploit attempt.
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies, makeUpload } = require('../helpers/factory');

const HOUR = 3600e3;
const IMG = (n = 1) => `https://res.cloudinary.com/demo/image/upload/proofs/p${n}.png`;
const xpOf = async (u) => (await prisma.user.findUnique({ where: { id: u.user.id } })).xpTotal;

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('XP farming', () => {
  test('collab bonus cannot be claimed in a loop (solo entry, no buddy)', async () => {
    const A = await makeUser();
    const ch = await prisma.challenge.create({ data: { id: uuid(), title: 'x', description: 'x', type: 'solo',
      startAt: new Date(Date.now() - 864e5), endAt: new Date(Date.now() + 864e5), xpPool: 1 } });
    const st = await prisma.challengeStation.create({ data: { id: uuid(), challengeId: ch.id, stationNum: 1, title: 's', description: 'x', xpReward: 10 } });
    const entry = await prisma.challengeEntry.create({ data: { id: uuid(), challengeId: ch.id, userId: A.user.id, currentStation: 2 } });
    const c = await prisma.stationCompletion.create({ data: { id: uuid(), entryId: entry.id, stationId: st.id, stationNum: 1, xpAwarded: 10 } });
    const x0 = await xpOf(A);
    for (let i = 0; i < 5; i++) {
      await api().post(`${API}/challenges/${ch.id}/collab`).set(A.auth).send({ stationCompletionId: c.id });
    }
    expect(await xpOf(A)).toBe(x0);
  });

  test('collab bonus is paid once even with a buddy', async () => {
    const A = await makeUser(); const B = await makeUser();
    await makeBuddies(A.user, B.user);
    const ch = await prisma.challenge.create({ data: { id: uuid(), title: 'x', description: 'x', type: 'solo',
      startAt: new Date(Date.now() - 864e5), endAt: new Date(Date.now() + 864e5), xpPool: 1 } });
    const st = await prisma.challengeStation.create({ data: { id: uuid(), challengeId: ch.id, stationNum: 1, title: 's', description: 'x', xpReward: 10 } });
    const entry = await prisma.challengeEntry.create({ data: { id: uuid(), challengeId: ch.id, userId: A.user.id, buddyId: B.user.id, currentStation: 2 } });
    const c = await prisma.stationCompletion.create({ data: { id: uuid(), entryId: entry.id, stationId: st.id, stationNum: 1, xpAwarded: 10 } });
    const x0 = await xpOf(B);
    await Promise.all([1, 2, 3].map(() =>
      api().post(`${API}/challenges/${ch.id}/collab`).set(B.auth).send({ stationCompletionId: c.id })));
    expect(await xpOf(B)).toBe(x0 + 10);
  });

  test('solo sessions: the same proof photo cannot be reused', async () => {
    const A = await makeUser(); const B = await makeUser();
    await makeBuddies(A.user, B.user);
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const r = await api().post(`${API}/sessions`).set(A.auth).send({
        activity: 'gym', scheduledAt: new Date(Date.now() + (i + 1) * HOUR).toISOString(), buddyIds: [] });
      ids.push(r.body.data.id);
    }
    await prisma.workoutSession.updateMany({ where: { id: { in: ids } }, data: {
      scheduledAt: new Date(Date.now() - 2 * HOUR), endTime: new Date(Date.now() - HOUR) } });
    const img = await makeUpload(A.user);
    const up = (id) => api().post(`${API}/sessions/${id}/proof`).set(A.auth).send({ proofImageUrl: img });
    expect((await up(ids[0])).status).toBe(200);
    expect((await up(ids[1])).status).toBe(409);
  });

  test('solo session XP is capped per day', async () => {
    const A = await makeUser(); const B = await makeUser();
    await makeBuddies(A.user, B.user);
    const results = [];
    // tomorrow 8, 9, 10, 11 AM (IST) — all on the same calendar day
    const { dayBounds } = require('../../src/controllers/session.controller');
    const tomorrow = dayBounds(new Date(Date.now() + 24 * HOUR)).start.getTime();
    for (let i = 0; i < 4; i++) {
      const r = await api().post(`${API}/sessions`).set(A.auth).send({
        activity: 'gym', scheduledAt: new Date(tomorrow + (8 + i) * HOUR).toISOString(), buddyIds: [] });
      results.push(r.status);
    }
    expect(results.filter(s => s === 201).length).toBeLessThanOrEqual(2);
  });
});

describe('Tokens & payments', () => {
  const secret = 'rzp_test_secret';
  beforeAll(() => { process.env.RAZORPAY_KEY_SECRET = secret; });
  const sign = (o, p) => crypto.createHmac('sha256', secret).update(`${o}|${p}`).digest('hex');

  test('referral code cannot be applied by an old account', async () => {
    const A = await makeUser(); const B = await makeUser({ createdAt: new Date(Date.now() - 30 * 24 * HOUR) });
    await prisma.referral.create({ data: { id: uuid(), referrerId: A.user.id, code: 'ABC123' } });
    const r = await api().post(`${API}/referral/apply`).set(B.auth).send({ code: 'ABC123' });
    expect(r.status).toBe(400);
  });

  test('referral: parallel applies pay only once', async () => {
    const A = await makeUser(); const B = await makeUser({ emailVerified: true });
    await prisma.referral.create({ data: { id: uuid(), referrerId: A.user.id, code: 'R1' } });
    await prisma.referral.create({ data: { id: uuid(), referrerId: A.user.id, code: 'R2' } });
    const t0 = (await prisma.user.findUnique({ where: { id: B.user.id } })).chatTokens;
    await Promise.all(['R1', 'R2', 'R1'].map(code =>
      api().post(`${API}/referral/apply`).set(B.auth).send({ code })));
    // nothing is paid at sign-up time any more…
    expect((await prisma.user.findUnique({ where: { id: B.user.id } })).chatTokens).toBe(t0);
    // …only after the first finished workout, and only once
    const { rewardReferral } = require('../../src/controllers/referral.controller');
    await Promise.all([rewardReferral(B.user.id), rewardReferral(B.user.id), rewardReferral(B.user.id)]);
    expect((await prisma.user.findUnique({ where: { id: B.user.id } })).chatTokens).toBe(t0 + 50);
    expect(await prisma.referral.count({ where: { referredId: B.user.id } })).toBe(1);
  });

  test('someone else\'s paid order cannot upgrade me', async () => {
    const A = await makeUser(); const B = await makeUser();
    const plan = await prisma.subscriptionPlanConfig.create({ data: { id: uuid(), slug: 'pro', name: 'Pro', price: 29900, interval: 'monthly' } });
    await prisma.order.create({ data: { id: uuid(), userId: A.user.id, planId: plan.id, razorpayOrderId: 'order_A', amount: 29900 } });
    const r = await api().post(`${API}/subscriptions/verify-payment`).set(B.auth)
      .send({ razorpay_order_id: 'order_A', razorpay_payment_id: 'pay_1', razorpay_signature: sign('order_A', 'pay_1') });
    expect(r.status).toBe(404);
    expect((await prisma.user.findUnique({ where: { id: B.user.id } })).subscriptionPlan).toBe('free');
  });

  test('token pack purchase actually credits the tokens (was a 500)', async () => {
    const A = await makeUser();
    const t0 = (await prisma.user.findUnique({ where: { id: A.user.id } })).chatTokens;
    await prisma.order.create({ data: { id: uuid(), userId: A.user.id, razorpayOrderId: 'order_T', amount: 4900, type: 'tokens', tokenPack: 20 } });
    const r = await api().post(`${API}/subscriptions/verify-payment`).set(A.auth)
      .send({ razorpay_order_id: 'order_T', razorpay_payment_id: 'pay_2', razorpay_signature: sign('order_T', 'pay_2') });
    expect(r.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: A.user.id } })).chatTokens).toBe(t0 + 20);
    // replay
    await api().post(`${API}/subscriptions/verify-payment`).set(A.auth)
      .send({ razorpay_order_id: 'order_T', razorpay_payment_id: 'pay_2', razorpay_signature: sign('order_T', 'pay_2') });
    expect((await prisma.user.findUnique({ where: { id: A.user.id } })).chatTokens).toBe(t0 + 20);
  });

  test('bad signature → refused', async () => {
    const A = await makeUser();
    await prisma.order.create({ data: { id: uuid(), userId: A.user.id, razorpayOrderId: 'order_X', amount: 4900, type: 'tokens', tokenPack: 20 } });
    const r = await api().post(`${API}/subscriptions/verify-payment`).set(A.auth)
      .send({ razorpay_order_id: 'order_X', razorpay_payment_id: 'pay_3', razorpay_signature: 'deadbeef' });
    expect(r.status).toBe(400);
  });

  test('expired subscription falls back to free', async () => {
    const A = await makeUser({ subscriptionPlan: 'pro', subscriptionExpiry: new Date(Date.now() - 1000) });
    await api().get(`${API}/auth/me`).set(A.auth);
    expect((await prisma.user.findUnique({ where: { id: A.user.id } })).subscriptionPlan).toBe('free');
  });
});

describe('Paywalls & privacy', () => {
  test('free user cannot like / super-like an influencer through any route', async () => {
    const A = await makeUser(); const I = await makeUser({ isInfluencer: true });
    expect((await api().post(`${API}/match/like`).set(A.auth).send({ targetUserId: I.user.id })).status).toBe(403);
    expect((await api().post(`${API}/match/swipe`).set(A.auth).send({ targetId: I.user.id, action: 'super_like' })).status).toBe(403);
  });

  test('distance is rounded — no metre-level location', async () => {
    const A = await makeUser({ latitude: 28.5355, longitude: 77.3910 });
    const B = await makeUser({ latitude: 28.5412, longitude: 77.3981 });
    const r = await api().get(`${API}/users/${B.user.id}/profile`).set(A.auth);
    const d = r.body.data.distanceKm;
    expect(Number.isInteger(d)).toBe(true);
  });
});

describe('Chat forgery', () => {
  test('a user cannot post fake "proof" or "session invite" cards', async () => {
    const A = await makeUser(); const B = await makeUser();
    const { chat } = await makeBuddies(A.user, B.user);
    for (const type of ['proof', 'session_invite', 'system']) {
      const r = await api().post(`${API}/chat/${chat.id}/messages`).set(A.auth)
        .send({ content: 'confirm me', type, metadata: { sessionId: uuid(), imageUrl: 'https://evil.io/x.gif' } });
      expect(r.status).toBe(422);
    }
  });

  test('image messages must be our uploads', async () => {
    const A = await makeUser(); const B = await makeUser();
    const { chat } = await makeBuddies(A.user, B.user);
    const bad = await api().post(`${API}/chat/${chat.id}/messages`).set(A.auth).send({ content: 'https://evil.io/x.gif', type: 'image' });
    expect(bad.status).toBe(422);
    const foreign = await api().post(`${API}/chat/${chat.id}/messages`).set(A.auth).send({ content: await makeUpload(B.user), type: 'image' });
    expect(foreign.status).toBe(422);
    const ok = await api().post(`${API}/chat/${chat.id}/messages`).set(A.auth).send({ content: await makeUpload(A.user), type: 'image' });
    expect(ok.status).toBe(201);
  });
});
