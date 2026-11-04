'use strict';
const { isAllowedMediaUrl } = require('../../src/utils/mediaUrl');

describe('isAllowedMediaUrl', () => {
  afterEach(() => { delete process.env.ALLOWED_MEDIA_HOSTS; });

  test.each([
    ['https://res.cloudinary.com/demo/image/upload/v1/proofs/a.png', true],
    ['https://res.cloudinary.com/attacker/image/upload/a.png', false], // someone else's Cloudinary
    ['https://RES.cloudinary.com/demo/a.png', true],
    ['http://res.cloudinary.com/demo/a.png', false],          // not https
    ['https://res.cloudinary.com.evil.io/a.png', false],       // look-alike host
    ['https://evil.io/res.cloudinary.com/a.png', false],
    ['https://user:pw@res.cloudinary.com/a.png', false],
    ['javascript:alert(1)', false],
    ['data:image/png;base64,AAAA', false],
    ['', false],
    [null, false],
    [{}, false],
  ])('%s → %s', (url, ok) => {
    expect(isAllowedMediaUrl(url)).toBe(ok);
  });

  test('any cloud allowed only when CLOUDINARY_CLOUD_NAME is unset', () => {
    const saved = process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    expect(isAllowedMediaUrl('https://res.cloudinary.com/other/a.png')).toBe(true);
    process.env.CLOUDINARY_CLOUD_NAME = saved;
  });

  test('extra hosts via ALLOWED_MEDIA_HOSTS', () => {
    process.env.ALLOWED_MEDIA_HOSTS = 'res.cloudinary.com, cdn.seshlly.com';
    expect(isAllowedMediaUrl('https://cdn.seshlly.com/x.jpg')).toBe(true);
  });
});
