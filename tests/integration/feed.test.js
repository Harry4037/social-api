'use strict';
// Pen-test findings on POST /feed: anyone could post a "workout" without
// doing it, attach any image URL, and put another person's name/photo on
// the post as a fake collab.
const { v4: uuid } = require('uuid');
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies } = require('../helpers/factory');

const IMG = 'https://res.cloudinary.com/demo/image/upload/proofs/p.png';

describe('POST /feed', () => {
  let A, B, challenge, station;
  beforeEach(async () => {
    await resetDb();
    A = await makeUser({ firstName: 'Asha' });
    B = await makeUser({ firstName: 'Bala' });
    await makeBuddies(A.user, B.user);
    challenge = await prisma.challenge.create({ data: {
      id: uuid(), title: 'Push Week', description: 'x', type: 'solo', tier: 1,
      startAt: new Date(Date.now() - 864e5), endAt: new Date(Date.now() + 864e5), xpPool: 100,
    } });
    station = await prisma.challengeStation.create({ data: {
      id: uuid(), challengeId: challenge.id, stationNum: 1, title: 'Pushups', description: 'x',
      verifyType: 'photo', targetValue: 1, xpReward: 30, buddyRequired: false,
    } });
  });
  afterAll(() => prisma.$disconnect());

  const complete = async (user, buddyId = null) => {
    const entry = await prisma.challengeEntry.create({ data: {
      id: uuid(), challengeId: challenge.id, userId: user.id, buddyId, currentStation: 2 } });
    return prisma.stationCompletion.create({ data: {
      id: uuid(), entryId: entry.id, stationId: station.id, stationNum: 1, xpAwarded: 30, isCollab: !!buddyId } });
  };
  const post = (auth, body) => api().post(`${API}/feed`).set(auth).send({ challengeId: challenge.id, stationTitle: 'x', ...body });

  test('cannot post without a completed station or session', async () => {
    const r = await post(A.auth, { stationNum: 1, proofImageUrl: IMG });
    expect(r.status).toBe(400);
  });

  test('cannot post someone else\'s station completion', async () => {
    const c = await complete(B.user);
    const r = await post(A.auth, { stationCompletionId: c.id, proofImageUrl: IMG });
    expect(r.status).toBe(403);
  });

  test('valid post: XP, station number and title come from the server', async () => {
    const c = await complete(A.user);
    const r = await post(A.auth, { stationCompletionId: c.id, proofImageUrl: IMG,
      stationTitle: 'I did 1000 pushups', stationNum: 9, xpAwarded: 9999 });
    expect(r.status).toBe(201);
    expect(r.body.data.post.xpAwarded).toBe(30);
    expect(r.body.data.post.stationNum).toBe(1);
    expect(r.body.data.post.stationTitle).toBe('Pushups');
  });

  test('collab name/avatar cannot be spoofed', async () => {
    const C = await makeUser({ firstName: 'Celebrity' });
    const c = await complete(A.user, B.user.id);
    const r = await post(A.auth, { stationCompletionId: c.id, proofImageUrl: IMG,
      isCollab: true, collabUserId: C.user.id, collabUserName: 'Celebrity', collabAvatarUrl: IMG });
    expect(r.status).toBe(201);
    expect(r.body.data.post.collabUserId).toBe(B.user.id);
    expect(r.body.data.post.collabUserName).toMatch(/^Bala/);
  });

  test('same completion cannot be posted twice', async () => {
    const c = await complete(A.user);
    expect((await post(A.auth, { stationCompletionId: c.id, proofImageUrl: IMG })).status).toBe(201);
    expect((await post(A.auth, { stationCompletionId: c.id, proofImageUrl: IMG })).status).toBe(409);
  });

  test('image must come from our uploads', async () => {
    const c = await complete(A.user);
    const r = await post(A.auth, { stationCompletionId: c.id, proofImageUrl: 'https://evil.io/x.png' });
    expect(r.status).toBe(422);
  });
});
