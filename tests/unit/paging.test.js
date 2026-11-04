'use strict';
const { pageParams } = require('../../src/utils/paging');

test.each([
  [{}, { page: 1, limit: 20, skip: 0 }],
  [{ page: '3', limit: '10' }, { page: 3, limit: 10, skip: 20 }],
  [{ page: '-5', limit: 'abc' }, { page: 1, limit: 20, skip: 0 }],
  [{ page: 'NaN', limit: '1000000' }, { page: 1, limit: 50, skip: 0 }],
  [{ page: '2.7', limit: '0' }, { page: 2, limit: 20, skip: 20 }],
])('%j', (q, out) => expect(pageParams(q)).toMatchObject(out));

test('custom default/max', () => {
  expect(pageParams({ limit: '500' }, { def: 30, max: 100 }).limit).toBe(100);
});
