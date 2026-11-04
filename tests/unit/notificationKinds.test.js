'use strict';
const { typeForKind } = require('../../src/services/notification.service');

// Every value here must exist in the NotificationType enum (schema.prisma) —
// unknown types made notifications fail silently.
const ENUM = ['match', 'session', 'proof', 'chat', 'token', 'xp', 'payment', 'subscription', 'system'];

test.each([
  ['new_match', 'match'], ['match_request', 'match'], ['match_accepted', 'match'],
  ['strike_received', 'match'], ['streak_warning', 'match'],
  ['session_missed', 'session'], ['level_up', 'xp'], ['trust_level_up', 'xp'],
  ['token_low', 'token'], ['xp', 'xp'], ['something_new', 'system'],
])('%s → %s', (kind, type) => {
  expect(typeForKind(kind)).toBe(type);
  expect(ENUM).toContain(typeForKind(kind));
});

test('enum list matches schema.prisma', () => {
  const schema = require('fs').readFileSync(require('path').join(__dirname, '../../prisma/schema.prisma'), 'utf8');
  const block = schema.match(/enum NotificationType \{([^}]*)\}/)[1];
  const values = block.split('\n').map(l => l.replace(/\/\/.*/, '').trim()).filter(Boolean);
  expect(values.sort()).toEqual([...ENUM].sort());
});
