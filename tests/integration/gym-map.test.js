'use strict';
// Bug #4: map showed no gyms (Google key missing → "coming soon").
// Now: free OpenStreetMap fallback, and check-in only when you are at the gym.
const axios = require('axios');
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies } = require('../helpers/factory');
const gymCtrl = require('../../src/controllers/gym.controller');

const NOIDA = { lat: 28.5355, lng: 77.3910 };
const overpassReply = { data: { elements: [
  { type: 'node', id: 11, lat: 28.5361, lon: 77.3921, tags: { leisure: 'fitness_centre', name: "Gold's Gym Sector 18", 'addr:street': 'Sector 18', 'addr:city': 'Noida' } },
  { type: 'way', id: 22, center: { lat: 28.5401, lon: 77.3950 }, tags: { leisure: 'fitness_centre', name: 'Cult Noida' } },
  { type: 'node', id: 33, lat: 28.53, lon: 77.39, tags: { leisure: 'fitness_centre' } }, // no name → skipped
] } };

describe('Gym map', () => {
  let A, B, C;
  beforeEach(async () => {
    await resetDb();
    gymCtrl._clearCache();
    A = await makeUser(); B = await makeUser({ firstName: 'Bala' }); C = await makeUser();
    await makeBuddies(A.user, B.user);
    delete process.env.GOOGLE_MAPS_API_KEY;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => prisma.$disconnect());

  test('no Google key → gyms still load from OpenStreetMap', async () => {
    const spy = jest.spyOn(axios, 'post').mockResolvedValue(overpassReply);
    const r = await api().get(`${API}/gyms/nearby`).query(NOIDA).set(A.auth);
    expect(r.status).toBe(200);
    expect(r.body.data.source).toBe('osm');
    expect(r.body.data.gyms.map(g => g.name)).toEqual(["Gold's Gym Sector 18", 'Cult Noida']);
    expect(r.body.data.gyms[0]).toMatchObject({ placeId: 'osm:node/11', address: 'Sector 18, Noida' });
    expect(spy.mock.calls[0][0]).toMatch(/overpass/);
  });

  test('Google failing → falls back to OpenStreetMap', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'k';
    jest.spyOn(axios, 'post').mockImplementation(async (url) => {
      if (url.includes('googleapis')) throw new Error('quota');
      return overpassReply;
    });
    const r = await api().get(`${API}/gyms/nearby`).query(NOIDA).set(A.auth);
    expect(r.status).toBe(200);
    expect(r.body.data.gyms).toHaveLength(2);
  });

  test('search text is not injected into the Overpass query', async () => {
    const spy = jest.spyOn(axios, 'post').mockResolvedValue(overpassReply);
    await api().get(`${API}/gyms/nearby`).query({ ...NOIDA, q: 'gold"];out;(node(1);' }).set(A.auth);
    const sent = decodeURIComponent(String(spy.mock.calls[0][1]));
    expect(sent).not.toMatch(/node\(1\)/);
  });

  const checkIn = (u, at) => api().post(`${API}/gyms/checkin`).set(u.auth).send({
    placeId: 'osm:node/11', gymName: "Gold's Gym", lat: 28.5361, lng: 77.3921, ...at });

  test('fake gym coordinates do not help: position comes from our gym data', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue(overpassReply);
    // attacker 30 km away claims the gym is right where they stand
    const r = await checkIn(A, { lat: 28.70, lng: 77.10, myLat: 28.70, myLng: 77.10 });
    expect([403, 422]).toContain(r.status);
  });

  test('unknown gym id → refused', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({ data: { elements: [] } });
    const r = await checkIn(A, { placeId: 'osm:node/999', myLat: 28.5364, myLng: 77.3925 });
    expect(r.status).toBe(422);
  });

  test('check-in only when you are actually near the gym', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue(overpassReply);
    const far = await checkIn(A, { myLat: 28.70, myLng: 77.10 });        // ~30 km away
    expect(far.status).toBe(403);
    const missing = await checkIn(A, {});
    expect(missing.status).toBe(422);
    const near = await checkIn(A, { myLat: 28.5364, myLng: 77.3925 });   // ~50 m
    expect(near.status).toBe(201);
  });

  test('buddies see the check-in, strangers do not', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue(overpassReply);
    await checkIn(A, { myLat: 28.5364, myLng: 77.3925 });
    const b = await api().get(`${API}/gyms/buddies`).set(B.auth);
    expect(b.body.data.buddies.map(x => x.userId)).toEqual([A.user.id]);
    expect(b.body.data.buddies[0].gymName).toBe("Gold's Gym Sector 18"); // server's name, not the client's
    const c = await api().get(`${API}/gyms/buddies`).set(C.auth);
    expect(c.body.data.buddies).toEqual([]);
  });

  test('check-in spam is limited (buddies get notified each time)', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue(overpassReply);
    expect((await checkIn(A, { myLat: 28.5364, myLng: 77.3925 })).status).toBe(201);
    expect((await checkIn(A, { myLat: 28.5364, myLng: 77.3925 })).status).toBe(429);
  });
});
