'use strict';
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { prisma } = require('./db');
const { signAccess } = require('../../src/utils/jwt');

let n = 0;
const PASSWORD = 'Passw0rd!';

/** Create a user and return { user, token, auth } (auth = Authorization header). */
const makeUser = async (data = {}) => {
  n += 1;
  const user = await prisma.user.create({
    data: {
      email: `user${n}_${Date.now()}@test.seshlly.com`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      firstName: `User${n}`,
      lastName: 'Test',
      ...data,
    },
  });
  const token = signAccess({ sub: user.id, email: user.email, plan: user.subscriptionPlan });
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
};

/** Active match + 1:1 chat between two users. */
const makeBuddies = async (a, b) => {
  const match = await prisma.match.create({
    data: { id: uuid(), userAId: a.id, userBId: b.id, status: 'active' },
  });
  const chat = await prisma.chat.create({
    data: { id: uuid(), matchId: match.id, userAId: a.id, userBId: b.id },
  });
  return { match, chat };
};

/** Record a file as uploaded by `user` (what POST /upload does) and return its URL. */
const makeUpload = async (user, folder = 'proofs') => {
  n += 1;
  const url = `https://res.cloudinary.com/demo/image/upload/${folder}/${n}_${Date.now()}.png`;
  await prisma.upload.create({ data: { id: uuid(), userId: user.id, folder, filename: `${n}.png`, url } });
  return url;
};

module.exports = { makeUser, makeBuddies, makeUpload, PASSWORD };
