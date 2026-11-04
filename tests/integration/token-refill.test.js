'use strict';
// Elite is sold as "Everything in Pro", but the monthly token top-up only
// looked at Pro users. Elite got no tokens.
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');
const xpCtrl = require('../../src/controllers/xp.controller');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

test('Pro and Elite get the monthly tokens, Free does not', async () => {
  const { user: pro }   = await makeUser({ subscriptionPlan: 'pro',   chatTokens: 0 });
  const { user: elite } = await makeUser({ subscriptionPlan: 'elite', chatTokens: 0 });
  const { user: free }  = await makeUser({ subscriptionPlan: 'free',  chatTokens: 0 });
  await xpCtrl.refillProTokens();
  const t = async (u) => (await prisma.user.findUnique({ where: { id: u.id } })).chatTokens;
  expect(await t(pro)).toBe(50);
  expect(await t(elite)).toBe(50);
  expect(await t(free)).toBe(0);
});

test('session token reward: Elite has the same 200 cap as Pro', async () => {
  const { user: elite } = await makeUser({ subscriptionPlan: 'elite', chatTokens: 60 });
  const { user: free }  = await makeUser({ subscriptionPlan: 'free',  chatTokens: 50 });
  expect((await xpCtrl.awardToken(elite.id, 1, 'session_complete')).awarded).toBe(1);
  expect((await xpCtrl.awardToken(free.id, 1, 'session_complete')).awarded).toBe(0);
});
