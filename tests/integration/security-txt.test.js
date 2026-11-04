'use strict';
const { api } = require('../helpers/app');
test('security.txt tells researchers where to report bugs', async () => {
  const r = await api().get('/.well-known/security.txt');
  expect(r.status).toBe(200);
  expect(r.text).toMatch(/^Contact: mailto:/m);
  expect(r.text).toMatch(/^Expires: \d{4}-/m);
});
