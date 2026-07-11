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
  } catch (e) { console.log(e);next(e); }
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

    if (expected !== razorpay_signature) {
      return res_.error(res, 'Payment signature mismatch — possible tampering', 400);
    }

    const order = await prisma.order.findFirst({
      where:   { razorpayOrderId: razorpay_order_id },
      include: { plan: true },
    });
    if (!order) return res_.error(res, 'Order not found', 404);

    // Idempotency — already verified
    if (order.status === 'paid') {
      return res_.success(res, { alreadyProcessed: true }, 'Payment already processed');
    }

    const expiry = new Date();
    if (order.plan.interval === 'yearly') {
      expiry.setFullYear(expiry.getFullYear() + 1);
    } else {
      expiry.setMonth(expiry.getMonth() + 1);
    }

    await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data:  { status: 'paid', razorpayPaymentId: razorpay_payment_id, razorpaySignature: razorpay_signature },
      }),
      prisma.user.update({
        where: { id: req.user.id },
        data:  { subscriptionPlan: order.plan.slug, subscriptionExpiry: expiry },
      }),
    ]);

    await notifSvc.create({
      userId:  req.user.id,
      type:    'subscription',
      title:   `Welcome to ${order.plan.name}! 🏆`,
      message: `Your ${order.plan.name} subscription is now active.`,
    });

    return res_.success(res, { verified: true, plan: order.plan.slug }, 'Payment verified');
  } catch (e) { next(e); }
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

module.exports = { getPlans, createOrder, verifyPayment, buyTokens };
