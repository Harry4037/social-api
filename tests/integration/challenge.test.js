'use strict';
const { v4: uuid } = require('uuid');
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies, makeUpload } = require('../helpers/factory');

const IMG = 'https://res.cloudinary.com/demo/image/upload/proofs/s.png';

describe('Challenges', () => {
  let A, B, ch, s1, s2;
  beforeEach(async () => {
    await resetDb();
    A = await makeUser({ level: 3, trustScore: 55 });
    B = await makeUser();
    await makeBuddies(A.user, B.user);
    ch = await prisma.challenge.create({ data: { id: uuid(), title: 'Push Week', description: 'x', type: 'solo',
      tier: 1, trustRequired: 40, startAt: new Date(Date.now() - 864e5), endAt: new Date(Date.now() + 864e5), xpPool: 100 } });
    s1 = await prisma.challengeStation.create({ data: { id: uuid(), challengeId: ch.id, stationNum: 1, title: 'Pushups',
      description: 'x', xpReward: 30 } });
    s2 = await prisma.challengeStation.create({ data: { id: uuid(), challengeId: ch.id, stationNum: 2, title: 'Partner plank',
      description: 'x', xpReward: 40, buddyRequired: true } });
  });
  afterAll(() => prisma.$disconnect());

  const join = (u, body = {}) => api().post(`${API}/challenges/${ch.id}/join`).set(u.auth).send(body);
  // IMG placeholder → a fresh real upload of that user (like the in-app camera)
  const proof = async (u, body) => {
    const b = { ...body };
    if (b.proofImageUrl === IMG) b.proofImageUrl = await makeUpload(u.user);
    return api().post(`${API}/challenges/${ch.id}/proof`).set(u.auth).send(b);
  };

  test('trust-gated challenge: allowed with enough trust, refused without', async () => {
    expect((await join(A)).status).toBe(201);
    await prisma.user.update({ where: { id: B.user.id }, data: { trustScore: 10 } });
    expect((await join(B)).status).toBe(403);
  });

  test('stations in order, buddy station needs a buddy, last station completes', async () => {
    await join(A);
    expect((await proof(A, { stationId: s2.id, proofImageUrl: IMG })).status).toBe(409);
    const r1 = await proof(A, { stationId: s1.id, proofImageUrl: IMG });
    expect(r1.status).toBe(201);
    expect(r1.body.data.xpAwarded).toBe(30);
    expect((await proof(A, { proofImageUrl: IMG })).status).toBe(400);           // buddy required
    expect((await join(A, { buddyId: B.user.id })).status).toBe(201);            // add buddy later
    const r2 = await proof(A, { proofImageUrl: IMG });
    expect(r2.body.data.challengeCompleted).toBe(true);
    expect((await join(A)).status).toBe(409);                                    // can't re-join
    expect((await prisma.user.findUnique({ where: { id: A.user.id } })).xpTotal).toBeGreaterThanOrEqual(70);
  });

  test('only real buddies can be invited', async () => {
    const C = await makeUser();
    expect((await join(A, { buddyId: C.user.id })).status).toBe(400);
  });

  test('ended challenge refuses proofs', async () => {
    await join(A);
    await prisma.challenge.update({ where: { id: ch.id }, data: { endAt: new Date(Date.now() - 1000) } });
    expect((await proof(A, { proofImageUrl: IMG })).status).toBe(400);
  });

  test('station photo must be MY fresh upload, and only used once', async () => {
    await join(A);
    expect((await proof(A, { proofImageUrl: 'https://evil.io/x.png' })).status).toBe(422);
    const bUpload = await makeUpload(B.user);                 // someone else's photo
    expect((await proof(A, { proofImageUrl: bUpload })).status).toBe(422);
    const mine = await makeUpload(A.user);
    expect((await proof(A, { proofImageUrl: mine })).status).toBe(201);
    await join(A, { buddyId: B.user.id });
    expect((await proof(A, { proofImageUrl: mine })).status).toBe(409); // reused
  });

  test('two quick taps on "Complete station" pay XP once', async () => {
    await join(A);
    const img = await makeUpload(A.user);
    const send = () => api().post(`${API}/challenges/${ch.id}/proof`).set(A.auth).send({ proofImageUrl: img });
    const rs = await Promise.all([send(), send()]);
    expect(rs.filter(r => r.status === 201)).toHaveLength(1);
    expect(await prisma.stationCompletion.count()).toBe(1);
  });
});
