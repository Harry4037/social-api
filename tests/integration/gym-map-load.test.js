'use strict';
// Load test: 1300 map opens → 1300 calls to the free Overpass API (which
// allows ~2 at a time per server). When it was slow/down, every user waited
// 15 s and got an error. Now: one shared call per area, a short "failed"
// memory, and the last good list is served if Overpass fails.
const axios = require('axios');
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser } = require('../helpers/factory');
const gymCtrl = require('../../src/controllers/gym.controller');

const reply = { data: { elements: [
  { type: 'node', id: 11, lat: 28.5361, lon: 77.3921, tags: { leisure: 'fitness_centre', name: 'Iron Gym' } } ] } };
const near = (u) => api().get(`${API}/gyms/nearby?lat=28.5355&lng=77.3910`).set(u.auth);

beforeEach(async () => { await resetDb(); gymCtrl._clearCache(); delete process.env.GOOGLE_MAPS_API_KEY; });
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

test('30 people opening the map at once → ONE Overpass call', async () => {
  const spy = jest.spyOn(axios, 'post').mockImplementation(() => new Promise(r => setTimeout(() => r(reply), 100)));
  const users = await Promise.all(Array.from({ length: 30 }, () => makeUser()));
  const rs = await Promise.all(users.map(near));
  expect(rs.every(r => r.status === 200)).toBe(true);
  expect(spy).toHaveBeenCalledTimes(1);
});

test('Overpass down → failure remembered for a minute (no call storm)', async () => {
  const spy = jest.spyOn(axios, 'post').mockRejectedValue(new Error('timeout'));
  const u = await makeUser();
  for (let i = 0; i < 5; i++) expect((await near(u)).status).toBe(502);
  expect(spy).toHaveBeenCalledTimes(1);
});

test('Overpass fails after the cache expired → last good list is served', async () => {
  const u = await makeUser();
  jest.spyOn(axios, 'post').mockResolvedValueOnce(reply);
  expect((await near(u)).status).toBe(200);
  gymCtrl._expireCache(); // pretend 6 h passed
  jest.spyOn(axios, 'post').mockRejectedValue(new Error('429'));
  const r = await near(u);
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body)).toMatch(/Iron Gym/);
});
