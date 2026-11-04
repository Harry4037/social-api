'use strict';
const { _mapOsm, _overpassQuery } = require('../../src/controllers/gym.controller');

describe('OpenStreetMap gym mapping', () => {
  test('node with address', () => {
    expect(_mapOsm({ type: 'node', id: 1, lat: 1.5, lon: 2.5,
      tags: { name: 'Iron Gym', 'addr:housenumber': '12', 'addr:street': 'MG Road', 'addr:city': 'Pune' } }))
      .toEqual({ placeId: 'osm:node/1', name: 'Iron Gym', address: '12 MG Road, Pune',
        lat: 1.5, lng: 2.5, rating: null, ratingCount: 0, openNow: null });
  });
  test('way uses its centre point', () => {
    expect(_mapOsm({ type: 'way', id: 9, center: { lat: 3, lon: 4 }, tags: { name: 'Box' } }))
      .toMatchObject({ placeId: 'osm:way/9', lat: 3, lng: 4, address: null });
  });
  test('unnamed / no coordinates → skipped', () => {
    expect(_mapOsm({ type: 'node', id: 1, lat: 1, lon: 1, tags: {} })).toBeNull();
    expect(_mapOsm({ type: 'way', id: 1, tags: { name: 'x' } })).toBeNull();
  });
  test('search text is reduced to safe characters', () => {
    const q = _overpassQuery({ lat: 1, lng: 2, radius: 3000, q: 'Gold\'s "gym"];(.*)+ ' });
    expect(q).toContain('["name"~"Gold\'s gym",i]');
    expect(q).toContain('around:3000,1,2');
  });
  test('Hindi gym names still searchable', () => {
    expect(_overpassQuery({ lat: 1, lng: 2, radius: 1000, q: 'जिम' })).toContain('~"जिम"');
  });
});
