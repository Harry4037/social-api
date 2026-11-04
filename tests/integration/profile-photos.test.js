'use strict';
// Bug #3: opening a profile with 5 photos showed one photo and no swipe.
const { api, API } = require('../helpers/app');
const { prisma, resetDb } = require('../helpers/db');
const { makeUser, makeBuddies, makeUpload } = require('../helpers/factory');

// url(i) = photo i that B really uploaded through POST /upload
let urls = [];
const url = (i) => urls[i];

describe('Profile photos', () => {
  let A, B;
  beforeEach(async () => {
    await resetDb();
    A = await makeUser({ firstName: 'Viewer' });
    B = await makeUser({ firstName: 'Rohan' });
    urls = [null];
    for (let i = 1; i <= 6; i++) urls.push(await makeUpload(B.user, 'strike'));
    for (let i = 1; i <= 5; i++) {
      const r = await api().post(`${API}/users/me/photos`).set(B.auth).send({ url: url(i) });
      expect(r.status).toBeLessThan(300);
    }
  });
  afterAll(() => prisma.$disconnect());

  test('first uploaded photo becomes the avatar', async () => {
    const b = await prisma.user.findUnique({ where: { id: B.user.id } });
    expect(b.avatarUrl).toBe(url(1));
  });

  test('a 6th photo is refused (max 5)', async () => {
    const r = await api().post(`${API}/users/me/photos`).set(B.auth).send({ url: url(6) });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  test('someone else viewing the profile gets all 5 photos, main first', async () => {
    const r = await api().get(`${API}/users/${B.user.id}/profile`).set(A.auth);
    expect(r.status).toBe(200);
    expect(r.body.data.photos).toEqual([1, 2, 3, 4, 5].map(url));
  });

  test('Discover card carries all 5 photos', async () => {
    const r = await api().get(`${API}/match/discover`).set(A.auth);
    expect(r.status).toBe(200);
    const card = r.body.data.find(u => u.id === B.user.id);
    expect(card.photos).toHaveLength(5);
  });

  test('buddies list carries photos too', async () => {
    await makeBuddies(A.user, B.user);
    const r = await api().get(`${API}/match/buddies`).set(A.auth);
    expect(r.status).toBe(200);
    const list = Array.isArray(r.body.data) ? r.body.data : r.body.data.buddies;
    expect(list[0].photos).toHaveLength(5);
  });

  test('make photo 4 the main photo → avatar + order change', async () => {
    const mine = await api().get(`${API}/users/me/photos`).set(B.auth);
    const p4 = mine.body.data.photos.find(p => p.url === url(4));
    const r = await api().put(`${API}/users/me/photos/${p4.id}/main`).set(B.auth);
    expect(r.status).toBe(200);
    const view = await api().get(`${API}/users/${B.user.id}/profile`).set(A.auth);
    expect(view.body.data.photos[0]).toBe(url(4));
    expect(view.body.data.avatarUrl).toBe(url(4));
  });

  test('cannot delete or promote another user\'s photo', async () => {
    const mine = await api().get(`${API}/users/me/photos`).set(B.auth);
    const id = mine.body.data.photos[0].id;
    await api().delete(`${API}/users/me/photos/${id}`).set(A.auth); // idempotent 200, but…
    expect(await prisma.userPhoto.findUnique({ where: { id } })).not.toBeNull(); // …nothing deleted
    expect((await api().put(`${API}/users/me/photos/${id}/main`).set(A.auth)).status).toBe(404);
  });

  test('photo url must be one of OUR uploads (no javascript:, no random sites)', async () => {
    const C = await makeUser();
    for (const bad of [url(1) /* B's photo — not C's */, 'javascript:alert(1)', 'http://res.cloudinary.com/x.jpg',
                       'https://evil.example.com/track.gif', 'https://res.cloudinary.com.evil.io/x.jpg']) {
      const r = await api().post(`${API}/users/me/photos`).set(C.auth).send({ url: bad });
      expect(r.status).toBe(422);
    }
  });
});
