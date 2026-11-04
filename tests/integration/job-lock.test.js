'use strict';
// With 2+ API servers every cron ran on EACH server → weekly recap, streak
// warnings, win-back pushes sent twice. Now each tick runs on one server only.
const { prisma, resetDb } = require('../helpers/db');
const { runOnce, pruneJobRuns } = require('../../src/schedulers/jobLock');

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

test('same job + same minute on 3 servers → runs once', async () => {
  let runs = 0;
  const job = async () => { runs++; await new Promise(r => setTimeout(r, 50)); };
  const at = new Date('2026-11-01T13:30:10Z');
  const rs = await Promise.all([runOnce('weeklyRecap', job, at), runOnce('weeklyRecap', job, at), runOnce('weeklyRecap', job, at)]);
  expect(runs).toBe(1);
  expect(rs.filter(Boolean)).toHaveLength(1);
});

test('next minute / other job runs again; old rows pruned', async () => {
  let runs = 0; const job = async () => { runs++; };
  await runOnce('a', job, new Date('2026-11-01T10:00:00Z'));
  await runOnce('a', job, new Date('2026-11-01T10:01:00Z'));
  await runOnce('b', job, new Date('2026-11-01T10:01:00Z'));
  expect(runs).toBe(3);
  expect((await pruneJobRuns(new Date(Date.now() + 8 * 864e5))).deleted).toBe(3);
});

test('a failing job does not throw out of the scheduler', async () => {
  await expect(runOnce('boom', async () => { throw new Error('x'); })).resolves.toBe(true);
});
