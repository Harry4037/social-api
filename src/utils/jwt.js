'use strict';
const jwt = require('jsonwebtoken');

const signAccess = (payload) =>
  jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
  });

const signRefresh = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || '30d',
  });

const verifyAccess  = (token) => jwt.verify(token, process.env.JWT_ACCESS_SECRET);
const verifyRefresh = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET);

const issueTokenPair = (user) => ({
  accessToken:  signAccess ({ sub: user.id, email: user.email, plan: user.subscriptionPlan }),
  refreshToken: signRefresh({ sub: user.id }),
});

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh, issueTokenPair };
