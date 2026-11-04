'use strict';
const crypto   = require('crypto');
const { v4: uuid } = require('uuid');
const Razorpay = require('razorpay');
const prisma   = require('../config/db');
const res_     = require('../utils/response');
const notifSvc = require('../services/notification.service');

const getRazorpay = () => new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const TOKEN_PACK_PRICES = { 10: 2900, 20: 4900, 50: 9900 }; // INR paise

// GET /subscriptions/plans
const getPlans = async (req, res, next) => {
  try {
    const plans = await prisma.subscriptionPlanConfig.findMany({
      where:   { isActive: true },
      orderBy: { price: 'asc' },
    });
    const formatted = plans.map(p => ({
      ...p,
      features: typeof p.features === 'string' ? JSON.parse(p.features) : p.features,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    }));
    return res_.success(res, formatted);
  } catch (e) { next(e); }
};

// POST /subscriptions/order
const createOrder = async (req, res, next) => {
  try {
    const { planId } = req.body;
    const plan = await prisma.subscriptionPlanConfig.findUnique({ where: { id: planId } });
    if (!plan) return res_.error(res, 'Plan not found', 404);
    if (plan.price === 0) return res_.error(res, 'Free plan requires no payment', 400);

    const razorpay = getRazorpay();
    const rpOrder  = await razorpay.orders.create({
      amount:   plan.price,
      currency: 'INR',
      receipt:  `sub_${uuid().slice(0, 8)}`,
    });

    const order = await prisma.order.create({
      data: {
        id:              uuid(),
        userId:          req.user.id,
        planId,
        razorpayOrderId: rpOrder.id,
        amount:          plan.price,
        type:            'subscription',
      },
    });

    return res_.created(res, {
      id:           rpOrder.id,
      amount:       rpOrder.amount,
      currency:     rpOrder.currency,
      razorpayKeyId:process.env.RAZORPAY_KEY_ID,
      orderId:      order.id,
    });
  } catch (e) { next(e); }
};

// POST /subscriptions/verify-payment
const verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Signature verification
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    const a = Buffer.from(expected), b = Buffer.from(String(razorpay_signature || ''));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res_.error(res, 'Payment signature mismatch — possible tampering', 400);
    }

    // The order must belong to the logged-in user
    const order = await prisma.order.findFirst({
      where:   { razorpayOrderId: razorpay_order_id, userId: req.user.id },
      include: { plan: true },
    });
    if (!order) return res_.error(res, 'Order not found', 404);

    if (!order.plan && order.type !== 'tokens') return res_.error(res, 'Order has no plan', 400);
    const r = await fulfillOrder(order, razorpay_payment_id, razorpay_signature);
    if (r.already) return res_.success(res, { alreadyProcessed: true }, 'Payment already processed');
    return res_.success(res, { verified: true, ...r.result }, 'Payment verified');
  } catch (e) { next(e); }
};

// Credit a paid order — exactly once, whoever gets here first
// (the app's verify-payment, or Razorpay's webhook).
const fulfillOrder = async (order, paymentId, signature = null) => {
  const claim = await prisma.order.updateMany({
    where: { id: order.id, status: { not: 'paid' } },
    data:  { status: 'paid', razorpayPaymentId: paymentId, ...(signature && { razorpaySignature: signature }) },
  });
  if (claim.count === 0) return { already: true };

  if (order.type === 'tokens') {
    const tokens = Number(order.tokenPack) || 0;
    await prisma.user.update({ where: { id: order.userId }, data: { chatTokens: { increment: tokens } } });
    await notifSvc.create({
      userId: order.userId, type: 'token',
      title: `+${tokens} chat tokens 🎉`, message: 'Your tokens are ready to use.',
    });
    return { already: false, result: { tokensAdded: tokens } };
  }
  const expiry = new Date();
  if (order.plan.interval === 'yearly') expiry.setFullYear(expiry.getFullYear() + 1);
  else expiry.setMonth(expiry.getMonth() + 1);
  await prisma.user.update({
    where: { id: order.userId },
    data:  { subscriptionPlan: order.plan.slug, subscriptionExpiry: expiry },
  });
  await notifSvc.create({
    userId:  order.userId, type: 'subscription',
    title:   `Welcome to ${order.plan.name}! 🏆`,
    message: `Your ${order.plan.name} subscription is now active.`,
  });
  return { already: false, result: { plan: order.plan.slug } };
};

// POST /subscriptions/webhook  (Razorpay → server, no login)
// Dashboard → Webhooks: URL …/api/v1/subscriptions/webhook, events
// payment.captured + order.paid, secret = RAZORPAY_WEBHOOK_SECRET.
// Covers "paid, then the app closed before verify-payment".
const webhook = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ success: false, message: 'Webhook not configured' });
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const got = Buffer.from(String(req.get('X-Razorpay-Signature') || ''));
  const exp = Buffer.from(expected);
  if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) {
    return res.status(400).json({ success: false, message: 'Bad signature' });
  }
  const type = req.body?.event;
  const eventId = String(req.get('X-Razorpay-Event-Id') ||
    crypto.createHash('sha256').update(raw).digest('hex')).slice(0, 100);
  // Razorpay re-sends the same event until it gets a 2xx → handle it once
  let rec;
  try {
    rec = await prisma.webhookEvent.create({ data: { provider: 'razorpay', eventId, type: String(type || '').slice(0, 60) } });
  } catch (e) {
    if (e.code === 'P2002') return res.json({ success: true, duplicate: true });
    throw e;
  }
  try {
    if (type === 'payment.captured' || type === 'order.paid') {
      const pay = req.body?.payload?.payment?.entity || {};
      const orderId = pay.order_id || req.body?.payload?.order?.entity?.id;
      const order = orderId && await prisma.order.findUnique({ where: { razorpayOrderId: orderId }, include: { plan: true } });
      if (order && (order.type === 'tokens' || order.plan)) await fulfillOrder(order, pay.id || null);
    }
    return res.json({ success: true });
  } catch (e) {
    // forget the event so Razorpay's retry is processed
    await prisma.webhookEvent.delete({ where: { id: rec.id } }).catch(() => {});
    console.error('[razorpay webhook]', e.message);
    return res.status(500).json({ success: false });
  }
};

// POST /tokens/buy
const buyTokens = async (req, res, next) => {
  try {
    const { pack } = req.body;
    const price = TOKEN_PACK_PRICES[Number(pack)];
    if (!price) {
      return res_.error(res, `Invalid pack. Choose: ${Object.keys(TOKEN_PACK_PRICES).join(', ')}`, 400);
    }

    const razorpay = getRazorpay();
    const rpOrder  = await razorpay.orders.create({
      amount:   price,
      currency: 'INR',
      receipt:  `tok_${uuid().slice(0, 8)}`,
    });

    const order = await prisma.order.create({
      data: {
        id:              uuid(),
        userId:          req.user.id,
        razorpayOrderId: rpOrder.id,
        amount:          price,
        type:            'tokens',
        tokenPack:       Number(pack),
      },
    });

    return res_.created(res, {
      id:           rpOrder.id,
      amount:       rpOrder.amount,
      currency:     rpOrder.currency,
      razorpayKeyId:process.env.RAZORPAY_KEY_ID,
      orderId:      order.id,
      tokensPurchased: Number(pack),
    });
  } catch (e) { next(e); }
};

module.exports = { getPlans, createOrder, verifyPayment, buyTokens, webhook, fulfillOrder };
