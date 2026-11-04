'use strict';
// If the phone dies / closes the app after paying, POST /verify-payment never
// arrives → user charged but not upgraded. Razorpay's server-to-server
// webhook now finishes the order. Each event and each order is applied once.
const crypto = require('crypto');
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');
const { v4: uuid } = require('uuid');

process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const event = (orderId, paymentId, name = 'payment.captured') => ({
  event: name, payload: { payment: { entity: { id: paymentId, order_id: orderId, status: 'captured' } } } });
const hook = (body, { eventId = uuid(), secret = 'whsec_test' } = {}) => {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return api().post(`${API}/subscriptions/webhook`).set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', sig).set('X-Razorpay-Event-Id', eventId).send(raw);
};

test('webhook alone upgrades the user (app never called verify-payment)', async () => {
  const A = await makeUser();
  const plan = await prisma.subscriptionPlanConfig.create({ data: { id: uuid(), slug: 'pro', name: 'Pro', price: 29900, interval: 'monthly' } });
  await prisma.order.create({ data: { id: uuid(), userId: A.user.id, planId: plan.id, razorpayOrderId: 'order_W1', amount: 29900 } });
  const r = await hook(event('order_W1', 'pay_W1'));
  expect(r.status).toBe(200);
  const u = await prisma.user.findUnique({ where: { id: A.user.id } });
  expect(u.subscriptionPlan).toBe('pro');
  expect(u.subscriptionExpiry.getTime()).toBeGreaterThan(Date.now() + 25 * 864e5);
});

test('same event twice, and webhook + app verify → tokens credited once', async () => {
  const A = await makeUser();
  const t0 = (await prisma.user.findUnique({ where: { id: A.user.id } })).chatTokens;
  await prisma.order.create({ data: { id: uuid(), userId: A.user.id, razorpayOrderId: 'order_W2', amount: 4900, type: 'tokens', tokenPack: 20 } });
  const ev = event('order_W2', 'pay_W2');
  await Promise.all([hook(ev, { eventId: 'evt_1' }), hook(ev, { eventId: 'evt_1' }), hook(ev, { eventId: 'evt_2' })]);
  const sig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update('order_W2|pay_W2').digest('hex');
  const v = await api().post(`${API}/subscriptions/verify-payment`).set(A.auth)
    .send({ razorpay_order_id: 'order_W2', razorpay_payment_id: 'pay_W2', razorpay_signature: sig });
  expect(v.status).toBe(200);
  expect((await prisma.user.findUnique({ where: { id: A.user.id } })).chatTokens).toBe(t0 + 20);
});

test('bad signature → 400, nothing changes; unknown order / other events → 200 ignored', async () => {
  const A = await makeUser();
  await prisma.order.create({ data: { id: uuid(), userId: A.user.id, razorpayOrderId: 'order_W3', amount: 4900, type: 'tokens', tokenPack: 20 } });
  expect((await hook(event('order_W3', 'pay_W3'), { secret: 'wrong' })).status).toBe(400);
  expect((await prisma.order.findUnique({ where: { razorpayOrderId: 'order_W3' } })).status).toBe('created');
  expect((await hook(event('order_nope', 'pay_x'))).status).toBe(200);
  expect((await hook(event('order_W3', 'pay_W3', 'payment.failed'))).status).toBe(200);
  expect((await prisma.order.findUnique({ where: { razorpayOrderId: 'order_W3' } })).status).toBe('created');
});
