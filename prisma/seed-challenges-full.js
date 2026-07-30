// ─────────────────────────────────────────────────────────
//  seed-challenges-full.js
//  31 challenges seeded from Seshlly-50-Challenges-Admin-Import.xlsx
//  Run: node prisma/seed-challenges-full.js
//  Safe to re-run — uses upsert (won't duplicate)
// ─────────────────────────────────────────────────────────
'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  // End dates: 30, 45, or 60 days from now based on duration
  const end30 = new Date(now.getTime() + 30 * 86400000);
  const end45 = new Date(now.getTime() + 45 * 86400000);
  const end60 = new Date(now.getTime() + 60 * 86400000);
  let count = 0;

  // ── 1. Iron Will ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0001-4000-8000-000000000001' },
    update: {},
    create: {
      id:                 'c0ffee00-0001-4000-8000-000000000001',
      title:              'Iron Will',
      description:        '30 consecutive days of gym check-ins. Miss one — streak resets.',
      type:               'solo',
      tier:               3,
      environment:        'gym',
      activityType:       'gym',
      activityTag:        '🏋️ Gym only',
      startAt:            now,
      endAt:              end45,
      xpPool:             4300,
      entryLevelRequired: 3,
      trustRequired:      50,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'The Foundation', exerciseName:'Gym Check-in', setsReps:'7 sessions', description:'Complete 7 gym sessions in first 10 days', proofInstruction:'Upload gym selfie — face and equipment visible. Timestamp must show.', verifyType:'count', targetValue:7, buddyRequired:false, xpReward:200 },
    { stationNum:2, title:'The Early Riser', exerciseName:'Morning Session', setsReps:'5 sessions', description:'Complete 5 sessions before 7:00 AM', proofInstruction:'Selfie at gym with timestamp clearly showing before 07:00.', verifyType:'count', targetValue:5, buddyRequired:false, xpReward:300 },
    { stationNum:3, title:'The Heavy Day', exerciseName:'Compound Lifts', setsReps:'3 sets × 5 reps', description:'Squat, bench, deadlift in one session — 3 sets each', proofInstruction:'Video of all 3 lifts with weight visible. No half reps allowed.', verifyType:'count', targetValue:3, buddyRequired:false, xpReward:400 },
    { stationNum:4, title:'The Grinder', exerciseName:'Daily Sessions', setsReps:'15 sessions', description:'Complete 15 sessions in 20 days — no 2-day gaps', proofInstruction:'Gym selfie per session. No 2-day gap allowed.', verifyType:'count', targetValue:15, buddyRequired:false, xpReward:500 },
    { stationNum:5, title:'No Excuses', exerciseName:'Perfect Week', setsReps:'7 days straight', description:'Train every single day for 7 consecutive days', proofInstruction:'7 consecutive gym selfies. Same week timestamps required.', verifyType:'streak', targetValue:7, buddyRequired:false, xpReward:600 },
    { stationNum:6, title:'The PR Day', exerciseName:'1RM PR Lift', setsReps:'1 new PR', description:'Hit a new 1RM on any compound lift. Video required', proofInstruction:'Full video of PR attempt. Weight clearly shown. Spotter optional.', verifyType:'count', targetValue:1, buddyRequired:false, xpReward:800 },
    { stationNum:7, title:'Iron Will', exerciseName:'Full 30 Days', setsReps:'30 sessions', description:'Complete all 30 sessions. Zero missed days allowed', proofInstruction:'Final session selfie + all 30 sessions visible in your streak.', verifyType:'count', targetValue:30, buddyRequired:false, xpReward:1500 }
      ] },
    },
  });
  count++;
  console.log('✓ (1/31)', 'Iron Will');

  // ── 2. 5AM Warrior ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0002-4000-8000-000000000002' },
    update: {},
    create: {
      id:                 'c0ffee00-0002-4000-8000-000000000002',
      title:              '5AM Warrior',
      description:        'Complete 20 gym sessions before 6:00 AM in 30 days.',
      type:               'solo',
      tier:               2,
      environment:        'gym',
      activityType:       'gym',
      activityTag:        '🏋️ Gym only',
      startAt:            now,
      endAt:              end30,
      xpPool:             1400,
      entryLevelRequired: 3,
      trustRequired:      40,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'First Light', exerciseName:'Early Check-in', setsReps:'5 sessions', description:'5 sessions before 6AM in first 10 days', proofInstruction:'Selfie at gym with timestamp showing before 06:00.', verifyType:'count', targetValue:5, buddyRequired:false, xpReward:200 },
    { stationNum:2, title:'Dawn Patrol', exerciseName:'Pre-6AM Sessions', setsReps:'10 sessions', description:'10 sessions before 6AM by day 20', proofInstruction:'10 gym selfies with timestamps all before 06:00.', verifyType:'count', targetValue:10, buddyRequired:false, xpReward:400 },
    { stationNum:3, title:'5AM Warrior', exerciseName:'Full 20 Sessions', setsReps:'20 sessions', description:'Complete all 20 sessions before 6AM in 30 days', proofInstruction:'All 20 selfies with timestamps. Not a single one after 06:00.', verifyType:'count', targetValue:20, buddyRequired:false, xpReward:800 }
      ] },
    },
  });
  count++;
  console.log('✓ (2/31)', '5AM Warrior');

  // ── 3. The Powerlifter's Trial ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0003-4000-8000-000000000003' },
    update: {},
    create: {
      id:                 'c0ffee00-0003-4000-8000-000000000003',
      title:              'The Powerlifter\'s Trial',
      description:        'Hit a new 1RM PR on squat, bench, AND deadlift in 21 days.',
      type:               'solo',
      tier:               3,
      environment:        'gym',
      activityType:       'gym',
      activityTag:        '🏋️ Gym only',
      startAt:            now,
      endAt:              end45,
      xpPool:             4000,
      entryLevelRequired: 3,
      trustRequired:      50,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Squat PR', exerciseName:'Back Squat', setsReps:'1RM attempt', description:'Hit a new 1RM back squat. Full depth required.', proofInstruction:'Video of 1RM squat. Full depth visible. Weight shown.', verifyType:'count', targetValue:1, buddyRequired:false, xpReward:1000 },
    { stationNum:2, title:'Bench PR', exerciseName:'Bench Press', setsReps:'1RM attempt', description:'Hit a new 1RM bench press. Full lockout required.', proofInstruction:'Video of 1RM bench. Full lockout at top. Weight shown.', verifyType:'count', targetValue:1, buddyRequired:false, xpReward:1000 },
    { stationNum:3, title:'Deadlift PR', exerciseName:'Deadlift', setsReps:'1RM attempt', description:'Hit a new 1RM deadlift. Full lockout required.', proofInstruction:'Video of 1RM deadlift. Full lockout visible. Weight shown.', verifyType:'count', targetValue:1, buddyRequired:false, xpReward:2000 }
      ] },
    },
  });
  count++;
  console.log('✓ (3/31)', 'The Powerlifter\'s Trial');

  // ── 4. No Rest Day ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0004-4000-8000-000000000004' },
    update: {},
    create: {
      id:                 'c0ffee00-0004-4000-8000-000000000004',
      title:              'No Rest Day',
      description:        'Train 6 days a week for 4 consecutive weeks. One rest day max per week.',
      type:               'solo',
      tier:               3,
      environment:        'gym',
      activityType:       'gym',
      activityTag:        '🏋️ Gym only',
      startAt:            now,
      endAt:              end45,
      xpPool:             2000,
      entryLevelRequired: 3,
      trustRequired:      60,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Week 1', exerciseName:'6 Sessions', setsReps:'6 days', description:'Train 6 days in week 1. Max 1 rest day.', proofInstruction:'6 gym selfies from Mon-Sun. Max 1-day gap visible.', verifyType:'streak', targetValue:6, buddyRequired:false, xpReward:300 },
    { stationNum:2, title:'Week 2', exerciseName:'6 Sessions', setsReps:'6 days', description:'Train 6 days in week 2. No back-to-back rest days.', proofInstruction:'6 more gym selfies. Week 2 dates on timestamps.', verifyType:'streak', targetValue:6, buddyRequired:false, xpReward:400 },
    { stationNum:3, title:'Week 3', exerciseName:'6 Sessions', setsReps:'6 days', description:'Train 6 days in week 3. Fatigue sets in — push through.', proofInstruction:'6 gym selfies. Week 3 dates clearly visible.', verifyType:'streak', targetValue:6, buddyRequired:false, xpReward:500 },
    { stationNum:4, title:'Week 4', exerciseName:'6 Sessions', setsReps:'6 days', description:'Final week. 6 days again. Prove you\'re serious.', proofInstruction:'6 gym selfies. Week 4 dates. All 4 weeks visible.', verifyType:'streak', targetValue:6, buddyRequired:false, xpReward:800 }
      ] },
    },
  });
  count++;
  console.log('✓ (4/31)', 'No Rest Day');

  // ── 5. Bench Century ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0005-4000-8000-000000000005' },
    update: {},
    create: {
      id:                 'c0ffee00-0005-4000-8000-000000000005',
      title:              'Bench Century',
      description:        'Bench press your bodyweight for 10 reps. Video proof required.',
      type:               'solo',
      tier:               3,
      environment:        'gym',
      activityType:       'gym',
      activityTag:        '🏋️ Gym only',
      startAt:            now,
      endAt:              end45,
      xpPool:             3500,
      entryLevelRequired: 3,
      trustRequired:      55,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Build Phase', exerciseName:'Bench Press', setsReps:'3 sets × 5 reps', description:'3 sets at 80% of bodyweight. Build your base.', proofInstruction:'Video of 3 sets. Weight plate clearly shown.', verifyType:'count', targetValue:3, buddyRequired:false, xpReward:400 },
    { stationNum:2, title:'Volume Phase', exerciseName:'Bench Press', setsReps:'3 sets × 8 reps', description:'3 sets at 85% of bodyweight. Rep volume.', proofInstruction:'Video of all 3 sets. Full range of motion required.', verifyType:'count', targetValue:3, buddyRequired:false, xpReward:600 },
    { stationNum:3, title:'Bench Century', exerciseName:'Bench Press', setsReps:'1 set × 10 reps at BW', description:'Bench your exact bodyweight for 10 full reps.', proofInstruction:'Video of entire set. Weight = your bodyweight. All 10 reps shown.', verifyType:'count', targetValue:10, buddyRequired:false, xpReward:2500 }
      ] },
    },
  });
  count++;
  console.log('✓ (5/31)', 'Bench Century');

  // ── 6. The Marathon Builder ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0006-4000-8000-000000000006' },
    update: {},
    create: {
      id:                 'c0ffee00-0006-4000-8000-000000000006',
      title:              'The Marathon Builder',
      description:        'Run a cumulative 100km in 30 days. GPS proof required for every run.',
      type:               'solo',
      tier:               3,
      environment:        'outdoor',
      activityType:       'outdoor',
      activityTag:        '🌿 Outdoor',
      startAt:            now,
      endAt:              end45,
      xpPool:             3700,
      entryLevelRequired: 3,
      trustRequired:      50,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'First 20K', exerciseName:'Running', setsReps:'20km total', description:'Accumulate first 20km across any number of runs', proofInstruction:'GPS screenshot from Strava/Nike Run showing cumulative 20km.', verifyType:'count', targetValue:20, buddyRequired:false, xpReward:200 },
    { stationNum:2, title:'Halfway', exerciseName:'Running', setsReps:'50km total', description:'Reach 50km cumulative distance', proofInstruction:'GPS proof showing 50km+ total for the month.', verifyType:'count', targetValue:50, buddyRequired:false, xpReward:400 },
    { stationNum:3, title:'75K Mark', exerciseName:'Running', setsReps:'75km total', description:'Reach 75km — 3/4 of the way there', proofInstruction:'GPS proof showing 75km+ total.', verifyType:'count', targetValue:75, buddyRequired:false, xpReward:600 },
    { stationNum:4, title:'The Century', exerciseName:'Running', setsReps:'100km total', description:'Reach 100km. All GPS proof submitted for every run.', proofInstruction:'Final GPS screenshot showing 100km+ total for the month.', verifyType:'count', targetValue:100, buddyRequired:false, xpReward:2500 }
      ] },
    },
  });
  count++;
  console.log('✓ (6/31)', 'The Marathon Builder');

  // ── 7. Sub-25 5K ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0007-4000-8000-000000000007' },
    update: {},
    create: {
      id:                 'c0ffee00-0007-4000-8000-000000000007',
      title:              'Sub-25 5K',
      description:        'Run a sub-25-minute 5K. Upload official Strava or Nike Run screenshot.',
      type:               'solo',
      tier:               3,
      environment:        'outdoor',
      activityType:       'outdoor',
      activityTag:        '🌿 Outdoor',
      startAt:            now,
      endAt:              end45,
      xpPool:             4300,
      entryLevelRequired: 3,
      trustRequired:      50,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Base Building', exerciseName:'Running', setsReps:'5 runs', description:'Complete 5 runs of any distance in 2 weeks', proofInstruction:'GPS proof from tracking app for each run.', verifyType:'count', targetValue:5, buddyRequired:false, xpReward:300 },
    { stationNum:2, title:'Speed Work', exerciseName:'Interval Run', setsReps:'3 speed sessions', description:'3 interval training sessions — 400m repeats or tempo runs', proofInstruction:'GPS proof showing intervals. Description of workout in caption.', verifyType:'count', targetValue:3, buddyRequired:false, xpReward:500 },
    { stationNum:3, title:'Sub-25 5K', exerciseName:'5K Race Effort', setsReps:'1 timed 5K', description:'Run a full 5K in under 25 minutes', proofInstruction:'Official Strava or Nike Run screenshot showing sub-25:00 5K.', verifyType:'count', targetValue:1, buddyRequired:false, xpReward:3500 }
      ] },
    },
  });
  count++;
  console.log('✓ (7/31)', 'Sub-25 5K');

  // ── 8. The Century Cyclist ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0008-4000-8000-000000000008' },
    update: {},
    create: {
      id:                 'c0ffee00-0008-4000-8000-000000000008',
      title:              'The Century Cyclist',
      description:        'Complete a 100km cycling ride in a single session. GPS required.',
      type:               'solo',
      tier:               3,
      environment:        'outdoor',
      activityType:       'outdoor',
      activityTag:        '🌿 Outdoor',
      startAt:            now,
      endAt:              end45,
      xpPool:             5800,
      entryLevelRequired: 3,
      trustRequired:      55,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Base Rides', exerciseName:'Cycling', setsReps:'3 rides × 30km', description:'Three 30km+ rides to build base fitness', proofInstruction:'GPS proof per ride showing 30km+ each.', verifyType:'count', targetValue:3, buddyRequired:false, xpReward:500 },
    { stationNum:2, title:'Long Ride 1', exerciseName:'Cycling', setsReps:'1 ride × 60km', description:'Single 60km+ ride', proofInstruction:'GPS proof showing single 60km+ ride.', verifyType:'count', targetValue:60, buddyRequired:false, xpReward:800 },
    { stationNum:3, title:'The Century', exerciseName:'Cycling', setsReps:'100km in one ride', description:'100km in a single unbroken session', proofInstruction:'GPS proof showing 100km+ in one continuous ride. Screenshots acceptable.', verifyType:'count', targetValue:100, buddyRequired:false, xpReward:4500 }
      ] },
    },
  });
  count++;
  console.log('✓ (8/31)', 'The Century Cyclist');

  // ── 9. Morning Miles ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0009-4000-8000-000000000009' },
    update: {},
    create: {
      id:                 'c0ffee00-0009-4000-8000-000000000009',
      title:              'Morning Miles',
      description:        'Run before 7:00 AM on 20 of 30 days. GPS with timestamp required.',
      type:               'solo',
      tier:               2,
      environment:        'outdoor',
      activityType:       'outdoor',
      activityTag:        '🌿 Outdoor',
      startAt:            now,
      endAt:              end30,
      xpPool:             1800,
      entryLevelRequired: 2,
      trustRequired:      30,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'First 5 Runs', exerciseName:'Morning Run', setsReps:'5 pre-7AM runs', description:'5 runs completed before 7:00 AM in first 10 days', proofInstruction:'GPS screenshot with timestamp showing before 07:00.', verifyType:'count', targetValue:5, buddyRequired:false, xpReward:200 },
    { stationNum:2, title:'Halfway', exerciseName:'Morning Run', setsReps:'10 pre-7AM runs', description:'10 total pre-7AM runs by day 20', proofInstruction:'10 GPS proofs. All timestamps before 07:00.', verifyType:'count', targetValue:10, buddyRequired:false, xpReward:400 },
    { stationNum:3, title:'Morning Miles', exerciseName:'Morning Run', setsReps:'20 pre-7AM runs', description:'Complete 20 runs before 7AM in 30 days', proofInstruction:'All 20 GPS proofs with timestamps before 07:00.', verifyType:'count', targetValue:20, buddyRequired:false, xpReward:1200 }
      ] },
    },
  });
  count++;
  console.log('✓ (9/31)', 'Morning Miles');

  // ── 10. 100 Push-up Day ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0010-4000-8000-000000000010' },
    update: {},
    create: {
      id:                 'c0ffee00-0010-4000-8000-000000000010',
      title:              '100 Push-up Day',
      description:        'Complete 100 push-ups in a single session. Video proof of all reps.',
      type:               'solo',
      tier:               2,
      environment:        'no_gym',
      activityType:       'no_gym',
      activityTag:        '🤸 No gym needed',
      startAt:            now,
      endAt:              end30,
      xpPool:             2300,
      entryLevelRequired: 2,
      trustRequired:      30,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'25 Reps', exerciseName:'Push-ups', setsReps:'1 set × 25 reps', description:'First milestone — 25 consecutive push-ups', proofInstruction:'Video of 25 consecutive push-ups. Full range of motion.', verifyType:'count', targetValue:25, buddyRequired:false, xpReward:300 },
    { stationNum:2, title:'50 Reps', exerciseName:'Push-ups', setsReps:'50 total reps', description:'50 push-ups in 2 sets maximum', proofInstruction:'Video of 50 reps across max 2 sets. No break longer than 30 seconds.', verifyType:'count', targetValue:50, buddyRequired:false, xpReward:500 },
    { stationNum:3, title:'100 Push-up Day', exerciseName:'Push-ups', setsReps:'100 reps in one session', description:'100 push-ups in a single session. Any number of sets.', proofInstruction:'Video of all 100 reps or clear set-by-set videos totaling 100.', verifyType:'count', targetValue:100, buddyRequired:false, xpReward:1500 }
      ] },
    },
  });
  count++;
  console.log('✓ (10/31)', '100 Push-up Day');

  // ── 11. 30 Day HIIT War ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0011-4000-8000-000000000011' },
    update: {},
    create: {
      id:                 'c0ffee00-0011-4000-8000-000000000011',
      title:              '30 Day HIIT War',
      description:        '25 HIIT sessions of minimum 20 minutes in 30 days. No equipment needed.',
      type:               'solo',
      tier:               2,
      environment:        'no_gym',
      activityType:       'no_gym',
      activityTag:        '🤸 No gym needed',
      startAt:            now,
      endAt:              end30,
      xpPool:             2100,
      entryLevelRequired: 2,
      trustRequired:      30,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Warm Up', exerciseName:'HIIT', setsReps:'5 sessions × 20min', description:'5 HIIT sessions in first 10 days', proofInstruction:'Video clip or activity tracker screenshot showing 20min+ HIIT.', verifyType:'count', targetValue:5, buddyRequired:false, xpReward:200 },
    { stationNum:2, title:'Building Heat', exerciseName:'HIIT', setsReps:'12 sessions × 20min', description:'12 total sessions by day 20', proofInstruction:'12 HIIT proof submissions. Each 20 minutes minimum.', verifyType:'count', targetValue:12, buddyRequired:false, xpReward:400 },
    { stationNum:3, title:'HIIT War', exerciseName:'HIIT', setsReps:'25 sessions × 20min', description:'25 total sessions in 30 days — only 5 rest days', proofInstruction:'25 HIIT submissions. No more than 2 consecutive rest days.', verifyType:'count', targetValue:25, buddyRequired:false, xpReward:1500 }
      ] },
    },
  });
  count++;
  console.log('✓ (11/31)', '30 Day HIIT War');

  // ── 12. The Calisthenics Gauntlet ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0012-4000-8000-000000000012' },
    update: {},
    create: {
      id:                 'c0ffee00-0012-4000-8000-000000000012',
      title:              'The Calisthenics Gauntlet',
      description:        'Master 5 skills: pull-ups, dips, push-ups, L-sit, hollow body hold.',
      type:               'solo',
      tier:               3,
      environment:        'no_gym',
      activityType:       'no_gym',
      activityTag:        '🤸 No gym needed',
      startAt:            now,
      endAt:              end45,
      xpPool:             3800,
      entryLevelRequired: 3,
      trustRequired:      50,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Push-up Master', exerciseName:'Push-ups', setsReps:'30 consecutive reps', description:'30 consecutive push-ups in one set. Full range only.', proofInstruction:'Video of 30 consecutive push-ups. No pausing at top or bottom.', verifyType:'count', targetValue:30, buddyRequired:false, xpReward:500 },
    { stationNum:2, title:'Dip Master', exerciseName:'Dips', setsReps:'20 consecutive reps', description:'20 consecutive dips. Full lockout required.', proofInstruction:'Video of 20 consecutive dips. Full range of motion.', verifyType:'count', targetValue:20, buddyRequired:false, xpReward:600 },
    { stationNum:3, title:'Pull-up Master', exerciseName:'Pull-ups', setsReps:'10 consecutive reps', description:'10 dead hang pull-ups. Chin over bar each rep.', proofInstruction:'Video of 10 dead hang pull-ups. Chin clears bar every rep.', verifyType:'count', targetValue:10, buddyRequired:false, xpReward:800 },
    { stationNum:4, title:'L-Sit Hold', exerciseName:'L-Sit', setsReps:'10 second hold', description:'L-sit hold for 10 seconds straight. Hips at 90°.', proofInstruction:'Video of 10-second L-sit. Legs parallel to ground. Unbroken.', verifyType:'count', targetValue:10, buddyRequired:false, xpReward:900 },
    { stationNum:5, title:'Hollow Body', exerciseName:'Hollow Body Hold', setsReps:'20 second hold', description:'Hollow body hold for 20 seconds. Lower back on floor.', proofInstruction:'Video of 20-second hollow body. Lower back pressed to ground.', verifyType:'count', targetValue:20, buddyRequired:false, xpReward:1000 }
      ] },
    },
  });
  count++;
  console.log('✓ (12/31)', 'The Calisthenics Gauntlet');

  // ── 13. The Burpee 500 ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0013-4000-8000-000000000013' },
    update: {},
    create: {
      id:                 'c0ffee00-0013-4000-8000-000000000013',
      title:              'The Burpee 500',
      description:        'Complete 500 burpees across 10 sessions. Proof required per session.',
      type:               'solo',
      tier:               3,
      environment:        'no_gym',
      activityType:       'no_gym',
      activityTag:        '🤸 No gym needed',
      startAt:            now,
      endAt:              end45,
      xpPool:             3700,
      entryLevelRequired: 3,
      trustRequired:      50,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'First 100', exerciseName:'Burpees', setsReps:'100 reps over 2 sessions', description:'First 100 burpees across 2 sessions. 50 per session.', proofInstruction:'Video of each session. Count visible or stated in caption.', verifyType:'count', targetValue:100, buddyRequired:false, xpReward:400 },
    { stationNum:2, title:'Second 100', exerciseName:'Burpees', setsReps:'100 more reps', description:'Reach 200 total burpees across 4 sessions', proofInstruction:'Videos for sessions 3 and 4. Running total = 200.', verifyType:'count', targetValue:200, buddyRequired:false, xpReward:500 },
    { stationNum:3, title:'Third 100', exerciseName:'Burpees', setsReps:'100 more reps', description:'Reach 300 total burpees across 6 sessions', proofInstruction:'Videos for sessions 5 and 6. Running total = 300.', verifyType:'count', targetValue:300, buddyRequired:false, xpReward:600 },
    { stationNum:4, title:'Fourth 100', exerciseName:'Burpees', setsReps:'100 more reps', description:'Reach 400 total burpees across 8 sessions', proofInstruction:'Videos for sessions 7 and 8. Running total = 400.', verifyType:'count', targetValue:400, buddyRequired:false, xpReward:700 },
    { stationNum:5, title:'The 500', exerciseName:'Burpees', setsReps:'Final 100 reps', description:'Complete all 500 burpees. Sessions 9 and 10.', proofInstruction:'Final 2 session videos. Grand total = 500 burpees.', verifyType:'count', targetValue:500, buddyRequired:false, xpReward:1500 }
      ] },
    },
  });
  count++;
  console.log('✓ (13/31)', 'The Burpee 500');

  // ── 14. Yoga Every Day ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0014-4000-8000-000000000014' },
    update: {},
    create: {
      id:                 'c0ffee00-0014-4000-8000-000000000014',
      title:              'Yoga Every Day',
      description:        'Complete 21 yoga sessions of minimum 30 minutes in 21 days. No skipping.',
      type:               'solo',
      tier:               2,
      environment:        'no_gym',
      activityType:       'no_gym',
      activityTag:        '🤸 No gym needed',
      startAt:            now,
      endAt:              end30,
      xpPool:             2000,
      entryLevelRequired: 2,
      trustRequired:      20,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Week 1', exerciseName:'Yoga', setsReps:'7 sessions × 30min', description:'7 consecutive yoga sessions. No misses.', proofInstruction:'Video or app screenshot per session. Each 30 minutes minimum.', verifyType:'streak', targetValue:7, buddyRequired:false, xpReward:300 },
    { stationNum:2, title:'Week 2', exerciseName:'Yoga', setsReps:'14 consecutive sessions', description:'Continue to 14 consecutive sessions. No misses yet.', proofInstruction:'14 submissions. Streak must be unbroken from Day 1.', verifyType:'streak', targetValue:14, buddyRequired:false, xpReward:500 },
    { stationNum:3, title:'21 Day Yogi', exerciseName:'Yoga', setsReps:'21 consecutive sessions', description:'Complete all 21. Perfect attendance. No breaks.', proofInstruction:'All 21 submissions. Perfect streak required.', verifyType:'streak', targetValue:21, buddyRequired:false, xpReward:1200 }
      ] },
    },
  });
  count++;
  console.log('✓ (14/31)', 'Yoga Every Day');

  // ── 15. Push-up War (Solo) ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0015-4000-8000-000000000015' },
    update: {},
    create: {
      id:                 'c0ffee00-0015-4000-8000-000000000015',
      title:              'Push-up War (Solo)',
      description:        'Complete 1000 push-ups total across 20 sessions in 30 days.',
      type:               'solo',
      tier:               2,
      environment:        'no_gym',
      activityType:       'no_gym',
      activityTag:        '🤸 No gym needed',
      startAt:            now,
      endAt:              end30,
      xpPool:             2300,
      entryLevelRequired: 2,
      trustRequired:      30,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'First 250', exerciseName:'Push-ups', setsReps:'250 reps / 5 sessions', description:'First 250 push-ups across 5 sessions', proofInstruction:'Video or count per session. Running total shown.', verifyType:'count', targetValue:250, buddyRequired:false, xpReward:300 },
    { stationNum:2, title:'Halfway', exerciseName:'Push-ups', setsReps:'500 reps / 10 sessions', description:'Reach 500 push-ups across 10 sessions', proofInstruction:'10 session proofs. Running total = 500.', verifyType:'count', targetValue:500, buddyRequired:false, xpReward:500 },
    { stationNum:3, title:'The 1000', exerciseName:'Push-ups', setsReps:'1000 reps / 20 sessions', description:'Complete all 1000 push-ups across 20 sessions', proofInstruction:'All 20 session proofs. Grand total = 1000 push-ups.', verifyType:'count', targetValue:1000, buddyRequired:false, xpReward:1500 }
      ] },
    },
  });
  count++;
  console.log('✓ (15/31)', 'Push-up War (Solo)');

  // ── 16. 21 Day Habit Lock ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0016-4000-8000-000000000016' },
    update: {},
    create: {
      id:                 'c0ffee00-0016-4000-8000-000000000016',
      title:              '21 Day Habit Lock',
      description:        'Train every single day for 21 consecutive days. Any activity. Zero misses.',
      type:               'solo',
      tier:               1,
      environment:        'any',
      activityType:       'any',
      activityTag:        '⭐ Any activity',
      startAt:            now,
      endAt:              end30,
      xpPool:             1400,
      entryLevelRequired: 2,
      trustRequired:      20,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Week 1', exerciseName:'Any workout', setsReps:'7 days straight', description:'7 consecutive workout days. Any activity.', proofInstruction:'Proof per session. 7 consecutive days. Any workout counts.', verifyType:'streak', targetValue:7, buddyRequired:false, xpReward:200 },
    { stationNum:2, title:'Week 2', exerciseName:'Any workout', setsReps:'14 days straight', description:'Reach 14 consecutive days. No misses.', proofInstruction:'Proof per session. 14 days streak. No breaks.', verifyType:'streak', targetValue:14, buddyRequired:false, xpReward:400 },
    { stationNum:3, title:'21 Day Lock', exerciseName:'Any workout', setsReps:'21 days straight', description:'Complete 21 consecutive days. Habit locked.', proofInstruction:'All 21 proofs submitted. Perfect streak required.', verifyType:'streak', targetValue:21, buddyRequired:false, xpReward:800 }
      ] },
    },
  });
  count++;
  console.log('✓ (16/31)', '21 Day Habit Lock');

  // ── 17. The Seshlly Season ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0017-4000-8000-000000000017' },
    update: {},
    create: {
      id:                 'c0ffee00-0017-4000-8000-000000000017',
      title:              'The Seshlly Season',
      description:        'Complete 50 workout sessions in 60 days across any activity. Proof for all 50.',
      type:               'solo',
      tier:               3,
      environment:        'any',
      activityType:       'any',
      activityTag:        '⭐ Any activity',
      startAt:            now,
      endAt:              end45,
      xpPool:             5500,
      entryLevelRequired: 3,
      trustRequired:      55,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'First 10', exerciseName:'Any workout', setsReps:'10 sessions', description:'First 10 sessions in 60-day window', proofInstruction:'10 proof submissions. Any activity. No minimum duration.', verifyType:'count', targetValue:10, buddyRequired:false, xpReward:300 },
    { stationNum:2, title:'Quarter Way', exerciseName:'Any workout', setsReps:'25 sessions', description:'Reach 25 sessions', proofInstruction:'25 proof submissions accumulated.', verifyType:'count', targetValue:25, buddyRequired:false, xpReward:500 },
    { stationNum:3, title:'Three-Quarter', exerciseName:'Any workout', setsReps:'40 sessions', description:'Reach 40 sessions', proofInstruction:'40 proof submissions. 10 sessions remaining.', verifyType:'count', targetValue:40, buddyRequired:false, xpReward:700 },
    { stationNum:4, title:'The Season', exerciseName:'Any workout', setsReps:'50 sessions', description:'Complete all 50 sessions in 60 days', proofInstruction:'50 total proof submissions. Any 50 workout sessions.', verifyType:'count', targetValue:50, buddyRequired:false, xpReward:4000 }
      ] },
    },
  });
  count++;
  console.log('✓ (17/31)', 'The Seshlly Season');

  // ── 18. The Trust Builder ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0018-4000-8000-000000000018' },
    update: {},
    create: {
      id:                 'c0ffee00-0018-4000-8000-000000000018',
      title:              'The Trust Builder',
      description:        'Reach Trust Score 80+ without a single missed session for 30 days.',
      type:               'solo',
      tier:               2,
      environment:        'any',
      activityType:       'any',
      activityTag:        '⭐ Any activity',
      startAt:            now,
      endAt:              end30,
      xpPool:             2800,
      entryLevelRequired: 2,
      trustRequired:      30,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Trust 50', exerciseName:'Any workout', setsReps:'Trust reaches 50', description:'Reach Trust Score 50 through consistent sessions', proofInstruction:'Screenshot of your Trust Score showing 50+.', verifyType:'trust', targetValue:50, buddyRequired:false, xpReward:400 },
    { stationNum:2, title:'Trust 70', exerciseName:'Any workout', setsReps:'Trust reaches 70', description:'Reach Trust Score 70. No missed sessions allowed.', proofInstruction:'Screenshot of Trust Score showing 70+.', verifyType:'trust', targetValue:70, buddyRequired:false, xpReward:600 },
    { stationNum:3, title:'Trust 80', exerciseName:'Any workout', setsReps:'Trust reaches 80', description:'Reach Trust Score 80 within 30 days. Zero misses.', proofInstruction:'Screenshot of Trust Score showing 80+. Achieved in 30 days.', verifyType:'trust', targetValue:80, buddyRequired:false, xpReward:1800 }
      ] },
    },
  });
  count++;
  console.log('✓ (18/31)', 'The Trust Builder');

  // ── 19. The Streak Machine ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0019-4000-8000-000000000019' },
    update: {},
    create: {
      id:                 'c0ffee00-0019-4000-8000-000000000019',
      title:              'The Streak Machine',
      description:        'Maintain a 30-day workout streak. Any activity. Zero rest days.',
      type:               'solo',
      tier:               3,
      environment:        'any',
      activityType:       'any',
      activityTag:        '⭐ Any activity',
      startAt:            now,
      endAt:              end45,
      xpPool:             4100,
      entryLevelRequired: 3,
      trustRequired:      60,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'7-Day Fire', exerciseName:'Any workout', setsReps:'7 days straight', description:'7 consecutive workout days', proofInstruction:'7 proof submissions. Any activity each day.', verifyType:'streak', targetValue:7, buddyRequired:false, xpReward:300 },
    { stationNum:2, title:'14-Day Grind', exerciseName:'Any workout', setsReps:'14 days straight', description:'Reach 14 consecutive days. No cracks.', proofInstruction:'14 consecutive proofs. No gaps.', verifyType:'streak', targetValue:14, buddyRequired:false, xpReward:500 },
    { stationNum:3, title:'21-Day War', exerciseName:'Any workout', setsReps:'21 days straight', description:'Three weeks without a single missed day.', proofInstruction:'21 consecutive proofs. Week 3 is where most people fail.', verifyType:'streak', targetValue:21, buddyRequired:false, xpReward:800 },
    { stationNum:4, title:'30-Day Machine', exerciseName:'Any workout', setsReps:'30 days straight', description:'Complete all 30 days. Streak Machine badge earned.', proofInstruction:'30 consecutive proofs. Perfect attendance. Zero days missed.', verifyType:'streak', targetValue:30, buddyRequired:false, xpReward:2500 }
      ] },
    },
  });
  count++;
  console.log('✓ (19/31)', 'The Streak Machine');

  // ── 20. Double Session Day ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0020-4000-8000-000000000020' },
    update: {},
    create: {
      id:                 'c0ffee00-0020-4000-8000-000000000020',
      title:              'Double Session Day',
      description:        'Complete 2 workouts in a single day — 5 times in 30 days. Both need proof.',
      type:               'solo',
      tier:               2,
      environment:        'any',
      activityType:       'any',
      activityTag:        '⭐ Any activity',
      startAt:            now,
      endAt:              end30,
      xpPool:             2700,
      entryLevelRequired: 2,
      trustRequired:      35,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'First 2-a-Day', exerciseName:'Any 2 workouts', setsReps:'2 workouts same day', description:'Complete your first double session day', proofInstruction:'2 proofs with same-date timestamps. Different workouts count.', verifyType:'count', targetValue:2, buddyRequired:false, xpReward:300 },
    { stationNum:2, title:'Third 2-a-Day', exerciseName:'Any 2 workouts', setsReps:'3 total 2-a-days', description:'3 double session days completed', proofInstruction:'6 total proofs (2 per day × 3 days).', verifyType:'count', targetValue:6, buddyRequired:false, xpReward:400 },
    { stationNum:3, title:'Full 5', exerciseName:'Any 2 workouts', setsReps:'5 total 2-a-days', description:'Complete 5 double session days in 30 days', proofInstruction:'10 total proofs showing 5 days with 2 sessions each.', verifyType:'count', targetValue:10, buddyRequired:false, xpReward:2000 }
      ] },
    },
  });
  count++;
  console.log('✓ (20/31)', 'Double Session Day');

  // ── 21. XP Climber ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0021-4000-8000-000000000021' },
    update: {},
    create: {
      id:                 'c0ffee00-0021-4000-8000-000000000021',
      title:              'XP Climber',
      description:        'Earn 1000 XP within 30 days through sessions, streaks, and challenges.',
      type:               'solo',
      tier:               2,
      environment:        'any',
      activityType:       'any',
      activityTag:        '⭐ Any activity',
      startAt:            now,
      endAt:              end30,
      xpPool:             2000,
      entryLevelRequired: 2,
      trustRequired:      25,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'250 XP', exerciseName:'Any activity', setsReps:'250 XP earned', description:'Earn first 250 XP through any combination', proofInstruction:'Screenshot of XP total showing 250+.', verifyType:'count', targetValue:250, buddyRequired:false, xpReward:200 },
    { stationNum:2, title:'500 XP', exerciseName:'Any activity', setsReps:'500 XP earned', description:'Reach 500 XP halfway through the month', proofInstruction:'Screenshot of XP total showing 500+.', verifyType:'count', targetValue:500, buddyRequired:false, xpReward:300 },
    { stationNum:3, title:'XP Climber', exerciseName:'Any activity', setsReps:'1000 XP in 30 days', description:'Earn 1000 total XP within 30 days', proofInstruction:'Screenshot of XP total showing 1000+. Achieved within 30 days.', verifyType:'count', targetValue:1000, buddyRequired:false, xpReward:1500 }
      ] },
    },
  });
  count++;
  console.log('✓ (21/31)', 'XP Climber');

  // ── 22. The Bond ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0022-4000-8000-000000000022' },
    update: {},
    create: {
      id:                 'c0ffee00-0022-4000-8000-000000000022',
      title:              'The Bond',
      description:        'Train together for 5 joint sessions in 30 days. Both upload proof each session.',
      type:               'duel',
      tier:               2,
      environment:        'gym',
      activityType:       'gym',
      activityTag:        '🏋️ Gym only',
      startAt:            now,
      endAt:              end30,
      xpPool:             5000,
      entryLevelRequired: 3,
      trustRequired:      50,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'First Session', exerciseName:'Joint Gym Session', setsReps:'1 joint session', description:'First gym session together. Both upload proof.', proofInstruction:'Both partners upload gym selfie from same session. Timestamps within 2 hours.', verifyType:'count', targetValue:1, buddyRequired:true, xpReward:500 },
    { stationNum:2, title:'Third Together', exerciseName:'Joint Gym Session', setsReps:'3 joint sessions', description:'Complete 3 sessions together', proofInstruction:'Both partners: 3 proof submissions each. Same-day timestamps.', verifyType:'count', targetValue:3, buddyRequired:true, xpReward:1000 },
    { stationNum:3, title:'The Bond', exerciseName:'Joint Gym Session', setsReps:'5 joint sessions', description:'Complete all 5 sessions. The bond is forged.', proofInstruction:'Both partners: 5 proof submissions each. All within 2 hours of each other.', verifyType:'count', targetValue:5, buddyRequired:true, xpReward:3500 }
      ] },
    },
  });
  count++;
  console.log('✓ (22/31)', 'The Bond');

  // ── 23. Spot Me Bro ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0023-4000-8000-000000000023' },
    update: {},
    create: {
      id:                 'c0ffee00-0023-4000-8000-000000000023',
      title:              'Spot Me Bro',
      description:        '8 sessions together — at least 4 must include a compound lift.',
      type:               'duel',
      tier:               2,
      environment:        'gym',
      activityType:       'gym',
      activityTag:        '🏋️ Gym only',
      startAt:            now,
      endAt:              end30,
      xpPool:             4000,
      entryLevelRequired: 3,
      trustRequired:      45,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Compound Day 1', exerciseName:'Compound Lifts', setsReps:'1 joint compound session', description:'First joint session with squat, bench, or deadlift', proofInstruction:'Video of compound lift. Both partners visible or separate uploads.', verifyType:'count', targetValue:1, buddyRequired:true, xpReward:400 },
    { stationNum:2, title:'4 Compound Days', exerciseName:'Compound Lifts', setsReps:'4 compound sessions', description:'4 joint compound sessions completed together', proofInstruction:'4 proofs each showing compound lift. Same-day timestamps.', verifyType:'count', targetValue:4, buddyRequired:true, xpReward:800 },
    { stationNum:3, title:'Spot Me Bro', exerciseName:'Any Gym Session', setsReps:'8 joint sessions', description:'Complete all 8 sessions together', proofInstruction:'8 joint session proofs from both partners. Final 4 can be any exercise.', verifyType:'count', targetValue:8, buddyRequired:true, xpReward:2800 }
      ] },
    },
  });
  count++;
  console.log('✓ (23/31)', 'Spot Me Bro');

  // ── 24. Race You There ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0024-4000-8000-000000000024' },
    update: {},
    create: {
      id:                 'c0ffee00-0024-4000-8000-000000000024',
      title:              'Race You There',
      description:        'Both run 5K in under 28 minutes in the same week. GPS required.',
      type:               'duel',
      tier:               2,
      environment:        'outdoor',
      activityType:       'outdoor',
      activityTag:        '🌿 Outdoor',
      startAt:            now,
      endAt:              end30,
      xpPool:             2900,
      entryLevelRequired: 3,
      trustRequired:      40,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Training Runs', exerciseName:'Running', setsReps:'3 runs each', description:'Both partners complete 3 training runs', proofInstruction:'GPS proof per run. Both must submit 3 runs.', verifyType:'count', targetValue:3, buddyRequired:true, xpReward:400 },
    { stationNum:2, title:'Race Week', exerciseName:'5K Run', setsReps:'Sub-28 5K', description:'Both run sub-28-minute 5K in the same week', proofInstruction:'GPS screenshot showing sub-28:00 5K. Both partners in same week.', verifyType:'count', targetValue:1, buddyRequired:true, xpReward:2500 }
      ] },
    },
  });
  count++;
  console.log('✓ (24/31)', 'Race You There');

  // ── 25. The Long Run Pact ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0025-4000-8000-000000000025' },
    update: {},
    create: {
      id:                 'c0ffee00-0025-4000-8000-000000000025',
      title:              'The Long Run Pact',
      description:        'Run together for minimum 10km in 3 joint sessions within 30 days.',
      type:               'duel',
      tier:               2,
      environment:        'outdoor',
      activityType:       'outdoor',
      activityTag:        '🌿 Outdoor',
      startAt:            now,
      endAt:              end30,
      xpPool:             3300,
      entryLevelRequired: 2,
      trustRequired:      35,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'First Long Run', exerciseName:'Running', setsReps:'10km together', description:'First joint run of 10km or more', proofInstruction:'Both GPS proofs showing 10km+ same day. Within 30 min of each other.', verifyType:'count', targetValue:10, buddyRequired:true, xpReward:600 },
    { stationNum:2, title:'Second Long Run', exerciseName:'Running', setsReps:'10km together', description:'Second joint 10km+ run', proofInstruction:'Both GPS proofs showing 10km+ same day.', verifyType:'count', targetValue:10, buddyRequired:true, xpReward:700 },
    { stationNum:3, title:'Long Run Pact', exerciseName:'Running', setsReps:'3 × 10km together', description:'Complete 3 joint long runs of 10km each', proofInstruction:'3 joint long run proofs from both partners. The pact is complete.', verifyType:'count', targetValue:10, buddyRequired:true, xpReward:2000 }
      ] },
    },
  });
  count++;
  console.log('✓ (25/31)', 'The Long Run Pact');

  // ── 26. Push-up War ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0026-4000-8000-000000000026' },
    update: {},
    create: {
      id:                 'c0ffee00-0026-4000-8000-000000000026',
      title:              'Push-up War',
      description:        'Who does more push-ups in 14 days? Both track daily totals.',
      type:               'duel',
      tier:               2,
      environment:        'no_gym',
      activityType:       'no_gym',
      activityTag:        '🤸 No gym needed',
      startAt:            now,
      endAt:              end30,
      xpPool:             2700,
      entryLevelRequired: 2,
      trustRequired:      30,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'Day 1-5 Count', exerciseName:'Push-ups', setsReps:'Daily tracking', description:'Both submit daily push-up count for first 5 days', proofInstruction:'Daily log or video per partner. Caption shows daily count.', verifyType:'count', targetValue:5, buddyRequired:true, xpReward:300 },
    { stationNum:2, title:'Day 6-10 Count', exerciseName:'Push-ups', setsReps:'Daily tracking', description:'Continue daily tracking. Totals accumulate.', proofInstruction:'Both partners: 5 more daily submissions.', verifyType:'count', targetValue:10, buddyRequired:true, xpReward:400 },
    { stationNum:3, title:'Final Battle', exerciseName:'Push-ups', setsReps:'14 days total', description:'Complete 14 days. Highest total wins bonus XP.', proofInstruction:'All 14 days submitted. Total count in final caption.', verifyType:'count', targetValue:14, buddyRequired:true, xpReward:2000 }
      ] },
    },
  });
  count++;
  console.log('✓ (26/31)', 'Push-up War');

  // ── 27. Burpee Battle ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0027-4000-8000-000000000027' },
    update: {},
    create: {
      id:                 'c0ffee00-0027-4000-8000-000000000027',
      title:              'Burpee Battle',
      description:        'Both complete 200 burpees each in 10 days. Fastest finisher wins.',
      type:               'duel',
      tier:               2,
      environment:        'no_gym',
      activityType:       'no_gym',
      activityTag:        '🤸 No gym needed',
      startAt:            now,
      endAt:              end30,
      xpPool:             2600,
      entryLevelRequired: 2,
      trustRequired:      30,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'First 50', exerciseName:'Burpees', setsReps:'50 reps each', description:'Both partners reach 50 burpees in first 3 days', proofInstruction:'Video of session totaling first 50 burpees for each partner.', verifyType:'count', targetValue:50, buddyRequired:true, xpReward:400 },
    { stationNum:2, title:'Century', exerciseName:'Burpees', setsReps:'100 reps each', description:'Both reach 100 total burpees', proofInstruction:'Videos totaling 100 burpees per partner.', verifyType:'count', targetValue:100, buddyRequired:true, xpReward:600 },
    { stationNum:3, title:'Battle Won', exerciseName:'Burpees', setsReps:'200 reps each', description:'Complete all 200 burpees. First to finish gets bonus.', proofInstruction:'Videos showing 200 total burpees per partner. First finisher gets +200 XP bonus.', verifyType:'count', targetValue:200, buddyRequired:true, xpReward:1600 }
      ] },
    },
  });
  count++;
  console.log('✓ (27/31)', 'Burpee Battle');

  // ── 28. The January Pack ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0028-4000-8000-000000000028' },
    update: {},
    create: {
      id:                 'c0ffee00-0028-4000-8000-000000000028',
      title:              'The January Pack',
      description:        '8 stations. 30 days. Complete them all to earn the Seshlly Pack Trophy.',
      type:               'pack',
      tier:               2,
      environment:        'any',
      activityType:       'any',
      activityTag:        '⭐ Any activity',
      startAt:            now,
      endAt:              end60,
      xpPool:             2475,
      entryLevelRequired: 1,
      trustRequired:      0,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'The Foundation', exerciseName:'Any workout', setsReps:'10 sessions', description:'Complete 10 sessions in 30 days', proofInstruction:'Proof for each session. Any activity. 10 total.', verifyType:'count', targetValue:10, buddyRequired:false, xpReward:200 },
    { stationNum:2, title:'The Early Riser', exerciseName:'Morning Session', setsReps:'5 pre-7AM sessions', description:'5 sessions before 07:00 AM', proofInstruction:'Gym or outdoor selfie with timestamp before 07:00.', verifyType:'count', targetValue:5, buddyRequired:false, xpReward:150 },
    { stationNum:3, title:'The Loyalist', exerciseName:'Joint Session', setsReps:'3 buddy sessions', description:'3 sessions with the same buddy', proofInstruction:'Both partners upload proof. Same-day timestamps.', verifyType:'count', targetValue:3, buddyRequired:true, xpReward:200 },
    { stationNum:4, title:'The Diverse', exerciseName:'Cross-training', setsReps:'3 activities', description:'Sessions in 3 different activity types', proofInstruction:'3 proofs — each showing a different activity type.', verifyType:'count', targetValue:3, buddyRequired:false, xpReward:175 },
    { stationNum:5, title:'The Streak', exerciseName:'Any workout', setsReps:'7 day streak', description:'Train 7 consecutive days', proofInstruction:'7 consecutive daily proofs. No breaks.', verifyType:'streak', targetValue:7, buddyRequired:false, xpReward:300 },
    { stationNum:6, title:'The Trusted', exerciseName:'Any workout', setsReps:'Trust Score 70', description:'Reach Trust Score 70', proofInstruction:'Screenshot of Trust Score showing 70+.', verifyType:'trust', targetValue:70, buddyRequired:false, xpReward:400 },
    { stationNum:7, title:'The Recruiter', exerciseName:'Referral', setsReps:'Refer 1 person', description:'Refer 1 person who completes Station 1', proofInstruction:'Referred user must reach Station 1 completion.', verifyType:'referral', targetValue:1, buddyRequired:false, xpReward:250 },
    { stationNum:8, title:'The Finisher', exerciseName:'Any workout', setsReps:'All 7 stations done', description:'Complete all stations to claim the trophy', proofInstruction:'Final station submission. All previous stations verified.', verifyType:'count', targetValue:7, buddyRequired:false, xpReward:800 }
      ] },
    },
  });
  count++;
  console.log('✓ (28/31)', 'The January Pack');

  // ── 29. The Elite 30 ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0029-4000-8000-000000000029' },
    update: {},
    create: {
      id:                 'c0ffee00-0029-4000-8000-000000000029',
      title:              'The Elite 30',
      description:        '30 sessions in 30 days as a pack. Leaderboard ranks by sessions completed.',
      type:               'pack',
      tier:               3,
      environment:        'any',
      activityType:       'any',
      activityTag:        '⭐ Any activity',
      startAt:            now,
      endAt:              end45,
      xpPool:             6500,
      entryLevelRequired: 3,
      trustRequired:      60,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'First 7', exerciseName:'Any workout', setsReps:'7 sessions', description:'7 sessions in first 10 days', proofInstruction:'7 proof submissions. Any activity.', verifyType:'count', targetValue:7, buddyRequired:false, xpReward:300 },
    { stationNum:2, title:'Halfway', exerciseName:'Any workout', setsReps:'15 sessions', description:'Reach 15 sessions by day 15', proofInstruction:'15 proofs submitted.', verifyType:'count', targetValue:15, buddyRequired:false, xpReward:500 },
    { stationNum:3, title:'The Push', exerciseName:'Any workout', setsReps:'22 sessions', description:'22 sessions by day 22', proofInstruction:'22 proofs. 8 remaining. Don\'t stop now.', verifyType:'count', targetValue:22, buddyRequired:false, xpReward:700 },
    { stationNum:4, title:'Elite 30', exerciseName:'Any workout', setsReps:'30 sessions in 30 days', description:'Complete all 30 sessions. Zero rest days.', proofInstruction:'30 proofs. Perfect attendance. Leaderboard position by finish time.', verifyType:'streak', targetValue:30, buddyRequired:false, xpReward:5000 }
      ] },
    },
  });
  count++;
  console.log('✓ (29/31)', 'The Elite 30');

  // ── 30. The Hyrox Open ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0030-4000-8000-000000000030' },
    update: {},
    create: {
      id:                 'c0ffee00-0030-4000-8000-000000000030',
      title:              'The Hyrox Open',
      description:        'Complete all 8 Hyrox-style stations as a pack. Race to finish on leaderboard.',
      type:               'pack',
      tier:               3,
      environment:        'any',
      activityType:       'any',
      activityTag:        '⭐ Any activity',
      startAt:            now,
      endAt:              end60,
      xpPool:             3700,
      entryLevelRequired: 3,
      trustRequired:      60,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'SkiErg', exerciseName:'SkiErg / Rowing', setsReps:'1000m', description:'Complete 1000m SkiErg or rowing in one session', proofInstruction:'Video of SkiErg/rowing machine showing 1000m distance.', verifyType:'count', targetValue:1000, buddyRequired:false, xpReward:200 },
    { stationNum:2, title:'Sled Push', exerciseName:'Weighted Sled / Carries', setsReps:'50m weighted', description:'50m weighted sled push or farmer carry equivalent', proofInstruction:'Video of full 50m carry or push. Weight shown.', verifyType:'count', targetValue:50, buddyRequired:false, xpReward:250 },
    { stationNum:3, title:'Burpee Broad Jump', exerciseName:'Burpee Broad Jump', setsReps:'80 reps', description:'80 burpee broad jumps in one session', proofInstruction:'Video of 80 burpee broad jumps. Continuous session.', verifyType:'count', targetValue:80, buddyRequired:false, xpReward:300 },
    { stationNum:4, title:'Rowing', exerciseName:'Rowing Machine', setsReps:'1000m', description:'1000m on rowing machine in one session', proofInstruction:'Video of rowing machine showing 1000m completed.', verifyType:'count', targetValue:1000, buddyRequired:false, xpReward:300 },
    { stationNum:5, title:'Farmers Carry', exerciseName:'Farmers Carry', setsReps:'200m', description:'200m farmers carry with heavy weights', proofInstruction:'Video of 200m farmers carry. Weight used shown.', verifyType:'count', targetValue:200, buddyRequired:false, xpReward:350 },
    { stationNum:6, title:'Sandbag Lunges', exerciseName:'Sandbag Lunges', setsReps:'100m', description:'100m sandbag lunges', proofInstruction:'Video of 100m sandbag lunges. Sandbag clearly visible.', verifyType:'count', targetValue:100, buddyRequired:false, xpReward:400 },
    { stationNum:7, title:'Wall Balls', exerciseName:'Wall Ball', setsReps:'100 reps', description:'100 wall ball shots', proofInstruction:'Video of 100 wall balls. Ball hits target each rep.', verifyType:'count', targetValue:100, buddyRequired:false, xpReward:400 },
    { stationNum:8, title:'Run Finish', exerciseName:'Running', setsReps:'1km run', description:'Final 1km run. Hyrox complete.', proofInstruction:'GPS or treadmill proof showing 1km run. This is your finish line.', verifyType:'count', targetValue:1, buddyRequired:false, xpReward:1500 }
      ] },
    },
  });
  count++;
  console.log('✓ (30/31)', 'The Hyrox Open');

  // ── 31. GOAT Season ──
  await prisma.challenge.upsert({
    where:  { id: 'c0ffee00-0031-4000-8000-000000000031' },
    update: {},
    create: {
      id:                 'c0ffee00-0031-4000-8000-000000000031',
      title:              'GOAT Season',
      description:        'Level 9 only. 10 stations. 45 days. Prove you are the GOAT.',
      type:               'pack',
      tier:               4,
      environment:        'any',
      activityType:       'any',
      activityTag:        '⭐ Any activity',
      startAt:            now,
      endAt:              end60,
      xpPool:             12500,
      entryLevelRequired: 9,
      trustRequired:      95,
      isActive:           true,
      stations: { create: [
    { stationNum:1, title:'GOAT Station 1', exerciseName:'Any elite workout', setsReps:'5 sessions', description:'5 sessions in first 5 days. GOAT pace from day 1.', proofInstruction:'5 elite-level workout proofs. Any activity. No rest in first 5 days.', verifyType:'streak', targetValue:5, buddyRequired:false, xpReward:500 },
    { stationNum:2, title:'GOAT Station 2', exerciseName:'PRs or milestones', setsReps:'3 PRs', description:'Hit 3 personal records in any discipline', proofInstruction:'Video of each PR. Weight, time, or distance clearly shown.', verifyType:'count', targetValue:3, buddyRequired:false, xpReward:800 },
    { stationNum:3, title:'GOAT Station 3', exerciseName:'Streak', setsReps:'15 day streak', description:'15 consecutive training days. No breaks.', proofInstruction:'15 consecutive proofs. No gaps.', verifyType:'streak', targetValue:15, buddyRequired:false, xpReward:1000 },
    { stationNum:4, title:'GOAT Station 4', exerciseName:'Buddy sessions', setsReps:'5 joint sessions', description:'5 sessions with other GOAT-tier members', proofInstruction:'Both GOAT members upload proof. Timestamps within 2 hours.', verifyType:'count', targetValue:5, buddyRequired:true, xpReward:1200 },
    { stationNum:5, title:'GOAT Station 5', exerciseName:'Volume', setsReps:'30 sessions', description:'30 total sessions by station 5', proofInstruction:'30 cumulative proof submissions.', verifyType:'count', targetValue:30, buddyRequired:false, xpReward:1500 },
    { stationNum:6, title:'GOAT Station 6', exerciseName:'Trust', setsReps:'Trust Score 95', description:'Trust Score must be 95 or above', proofInstruction:'Screenshot of Trust Score showing 95+.', verifyType:'trust', targetValue:95, buddyRequired:false, xpReward:2000 },
    { stationNum:7, title:'GOAT Station 7', exerciseName:'Milestone', setsReps:'50 sessions total', description:'50 total sessions completed', proofInstruction:'50 cumulative proofs.', verifyType:'count', targetValue:50, buddyRequired:false, xpReward:2500 },
    { stationNum:8, title:'GOAT Station 8', exerciseName:'Elite challenge', setsReps:'5 Tier 3+ challenges', description:'Complete 5 other Tier 3 or 4 challenges during GOAT Season', proofInstruction:'Screenshots of 5 other challenge completions.', verifyType:'count', targetValue:5, buddyRequired:false, xpReward:3000 }
      ] },
    },
  });
  count++;
  console.log('✓ (31/31)', 'GOAT Season');

  console.log(`\n✅ Done — ${{count}} challenges seeded.`);
}

main()
  .catch(e => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());