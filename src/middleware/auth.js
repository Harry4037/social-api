'use strict';
const { verifyAccess } = require('../utils/jwt');
const { error }        = require('../utils/response');
const prisma           = require('../config/db');

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';    
    if (!header.startsWith('Bearer ')) {
      return error(res, 'No token provided', 401);
    }
    const token   = header.slice(7);
    const payload = verifyAccess(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, status: true, isBanned: true,
        subscriptionPlan: true, chatTokens: true,
      },
    });

    if (!user)           return error(res, 'User not found', 401);
    if (user.isBanned)   return error(res, 'Account suspended', 403);
    if (user.status === 'BANNED') return error(res, 'Account banned', 403);

    req.user = user;
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') return error(res, 'Token expired',  401);
    if (e.name === 'JsonWebTokenError') return error(res, 'Invalid token',  401);
    return error(res, 'Authentication error', 401);
  }
};

/** Require at least 1 chat token */
const requireToken = (req, res, next) => {
  if (req.user.chatTokens < 1) {
    return error(res, 'Insufficient chat tokens — buy more to continue chatting', 402);
  }
  next();
};

/** Require Pro or Elite plan */
const requirePro = (req, res, next) => {
  if (req.user.subscriptionPlan === 'free') {
    return error(res, 'Pro subscription required', 403);
  }
  next();
};

module.exports = { authenticate, requireToken, requirePro };
