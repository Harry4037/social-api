'use strict';
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
  // jti makes every refresh token unique — two logins/refreshes in the same
  // second used to produce the SAME token, so a "rotated" token kept working
  refreshToken: signRefresh({ sub: user.id, jti: crypto.randomUUID() }),
});

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh, issueTokenPair };
