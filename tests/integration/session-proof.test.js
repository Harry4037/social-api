'use strict';
// Full buddy-session life cycle: invite → accept → train → proof → confirm → XP
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies, makeUpload } = require('../helpers/factory');
const sessCtrl = require('../../src/controllers/session.controller');

const HOUR = 3600e3;
const IMG = 'https://res.cloudinary.com/demo/image/upload/proofs/p.png';

describe('Buddy session proof & XP', () => {
  let A, B, id;
  const xpOf = async (u) => (await prisma.user.findUnique({ where: { id: u.user.id } })).xpTotal;
  const trustOf = async (u) => Number((await prisma.user.findUnique({ where: { id: u.user.id } })).trustScore);

  beforeEach(async () => {
    await resetDb();
    A = await makeUser(); B = await makeUser();
    await makeBuddies(A.user, B.user);
    const r = await api().post(`${API}/sessions`).set(A.auth).send({
      activity: 'gym', scheduledAt: new Date(Date.now() + 2 * HOUR).toISOString(), buddyIds: [B.user.id] });
    id = r.body.data.id;
    await api().post(`${API}/sessions/${id}/respond`).set(B.auth).send({ action: 'confirm' });
    // the workout happened: ended 30 min ago
    await prisma.workoutSession.update({ where: { id }, data: {
      scheduledAt: new Date(Date.now() - 1.5 * HOUR), endTime: new Date(Date.now() - 0.5 * HOUR) } });
  });
  afterAll(() => prisma.$disconnect());

  const upload = async (u) => api().post(`${API}/sessions/${id}/proof`).set(u.auth).send({ proofImageUrl: await makeUpload(u.user) });
  const confirm = (u) => api().post(`${API}/sessions/${id}/confirm`).set(u.auth);

  test('proof before the session ends is refused', async () => {
    await prisma.workoutSession.update({ where: { id }, data: { endTime: new Date(Date.now() + HOUR) } });
    expect((await upload(A)).status).toBe(422);
  });

  test('upload → buddy confirms → both get XP, session completed', async () => {
    const [a0, b0] = [await xpOf(A), await xpOf(B)];
    expect((await upload(A)).status).toBe(200);
    expect((await confirm(A)).status).toBe(403);           // can't confirm your own proof
    const c = await confirm(B);
    expect(c.status).toBe(200);
    expect(await xpOf(A)).toBeGreaterThan(a0);
    expect(await xpOf(B)).toBeGreaterThan(b0);
    expect((await prisma.workoutSession.findUnique({ where: { id } })).status).toBe('completed');
  });

  test('double confirm (two taps / two phones) only pays once', async () => {
    await upload(A);
    const results = await Promise.all([confirm(B), confirm(B), confirm(B)]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    const xpRows = await prisma.xpTransaction?.count?.({ where: { userId: B.user.id } }).catch(() => null);
    if (xpRows != null) expect(xpRows).toBeLessThanOrEqual(2);
  });

  test('second proof upload is refused', async () => {
    await upload(A);
    expect((await upload(B)).status).toBe(409);
  });

  test('confirmer ignores it for 2h → uploader still gets XP, confirmer loses trust', async () => {
    await upload(A);
    await prisma.workoutSession.update({ where: { id }, data: { proofUploadedAt: new Date(Date.now() - 2.1 * HOUR) } });
    const [a0, bTrust] = [await xpOf(A), await trustOf(B)];
    expect((await confirm(B)).status).toBe(422);              // window closed
    await sessCtrl.processProofConfirmations();
    const s = await prisma.workoutSession.findUnique({ where: { id } });
    expect(s.status).toBe('completed');
    expect(s.confirmTimedOut).toBe(true);
    expect(await xpOf(A)).toBeGreaterThan(a0);
    expect(await trustOf(B)).toBeLessThan(bTrust);
  });

  test('no proof within 3h of the end → missed, creator penalised once', async () => {
    await prisma.workoutSession.update({ where: { id }, data: { endTime: new Date(Date.now() - 4 * HOUR) } });
    const t0 = await trustOf(A);
    await sessCtrl.markIncomplete();
    await sessCtrl.markIncomplete();                          // cron runs again
    expect((await prisma.workoutSession.findUnique({ where: { id } })).status).toBe('missed');
    expect(await trustOf(A)).toBe(t0 - 5);
  });
});

describe('Solo session proof', () => {
  afterAll(() => prisma.$disconnect());
  test('two quick uploads pay solo XP once', async () => {
    await resetDb();
    const A = await makeUser(); const B = await makeUser();
    await makeBuddies(A.user, B.user); // a match is required to schedule at all
    const r = await api().post(`${API}/sessions`).set(A.auth).send({
      activity: 'gym', scheduledAt: new Date(Date.now() + HOUR).toISOString(), buddyIds: [] });
    const id = r.body.data.id;
    await prisma.workoutSession.update({ where: { id }, data: {
      scheduledAt: new Date(Date.now() - 2 * HOUR), endTime: new Date(Date.now() - HOUR) } });
    const img = await makeUpload(A.user);
    const send = () => api().post(`${API}/sessions/${id}/proof`).set(A.auth).send({ proofImageUrl: img });
    const rs = await Promise.all([send(), send(), send()]);
    expect(rs.filter(x => x.status === 200)).toHaveLength(1);
    expect((await prisma.user.findUnique({ where: { id: A.user.id } })).xpTotal).toBe(50);
  });
});

describe('Proof photo timing (security #5)', () => {
  afterAll(() => prisma.$disconnect());
  test('a photo uploaded BEFORE the session started is refused', async () => {
    await resetDb();
    const A = await makeUser(); const B = await makeUser();
    await makeBuddies(A.user, B.user);
    const r = await api().post(`${API}/sessions`).set(A.auth).send({
      activity: 'gym', scheduledAt: new Date(Date.now() + HOUR).toISOString(), buddyIds: [] });
    const id = r.body.data.id;
    const old = await makeUpload(A.user);
    await prisma.upload.updateMany({ where: { url: old }, data: { createdAt: new Date(Date.now() - 5 * HOUR) } });
    await prisma.workoutSession.update({ where: { id }, data: {
      scheduledAt: new Date(Date.now() - 2 * HOUR), endTime: new Date(Date.now() - HOUR) } });
    const bad = await api().post(`${API}/sessions/${id}/proof`).set(A.auth).send({ proofImageUrl: old });
    expect(bad.status).toBe(422);
    const good = await api().post(`${API}/sessions/${id}/proof`).set(A.auth).send({ proofImageUrl: await makeUpload(A.user) });
    expect(good.status).toBe(200);
  });
});
