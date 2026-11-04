'use strict';
// Privacy settings in the app were saved only on the phone — the server
// ignored them, so a "Hidden" profile still showed up in Discover.
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies } = require('../helpers/factory');

describe('Privacy settings', () => {
  let A, B;
  beforeEach(async () => {
    await resetDb();
    A = await makeUser({ latitude: 28.5355, longitude: 77.3910 });
    B = await makeUser({ latitude: 28.5412, longitude: 77.3981, lastActiveAt: new Date() });
  });
  afterAll(() => prisma.$disconnect());

  const set = (u, body) => api().put(`${API}/users/me`).set(u.auth).send(body);
  const discoverIds = async (u) => (await api().get(`${API}/match/discover`).set(u.auth)).body.data.map(x => x.id);

  test('settings are saved on the server and returned with /auth/me', async () => {
    const r = await set(B, { profileVisibility: 'hidden', shareLocation: false, showOnline: false });
    expect(r.status).toBe(200);
    const me = await api().get(`${API}/auth/me`).set(B.auth);
    const u = me.body.data.user ?? me.body.data;
    expect(u).toMatchObject({ profileVisibility: 'hidden', shareLocation: false, showOnline: false });
  });

  test('invalid visibility rejected', async () => {
    expect((await set(B, { profileVisibility: 'everyone' })).status).toBe(422);
  });

  test('hidden / buddies-only profiles are not in Discover', async () => {
    expect(await discoverIds(A)).toContain(B.user.id);
    await set(B, { profileVisibility: 'buddies' });
    expect(await discoverIds(A)).not.toContain(B.user.id);
    await set(B, { profileVisibility: 'hidden' });
    expect(await discoverIds(A)).not.toContain(B.user.id);
  });

  test('non-public profile can be opened by buddies only', async () => {
    await set(B, { profileVisibility: 'buddies' });
    expect((await api().get(`${API}/users/${B.user.id}/profile`).set(A.auth)).status).toBe(404);
    await makeBuddies(A.user, B.user);
    expect((await api().get(`${API}/users/${B.user.id}/profile`).set(A.auth)).status).toBe(200);
  });

  test('location sharing off → no distance; online status off → never "online"', async () => {
    await set(B, { shareLocation: false, showOnline: false });
    const r = await api().get(`${API}/users/${B.user.id}/profile`).set(A.auth);
    expect(r.body.data.distanceKm).toBeNull();
    expect(r.body.data.isOnline).toBe(false);
  });
});
