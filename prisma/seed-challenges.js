// ─────────────────────────────────────────────────────────
//  seed-challenges.js
//  Run: node prisma/seed-challenges.js
//  Creates 3 starter challenges so the app is not empty.
// ─────────────────────────────────────────────────────────
'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const HYROX_STATIONS = [
  { stationNum:1, title:'The Foundation',  description:'Complete 10 sessions in 30 days',             verifyType:'count',    targetValue:10, buddyRequired:false, xpReward:200 },
  { stationNum:2, title:'The Early Riser', description:'Complete 5 sessions before 07:00 AM',          verifyType:'count',    targetValue:5,  buddyRequired:false, xpReward:150 },
  { stationNum:3, title:'The Loyalist',    description:'Complete 3 sessions with the same buddy',       verifyType:'count',    targetValue:3,  buddyRequired:true,  xpReward:200 },
  { stationNum:4, title:'The Diverse',     description:'Complete sessions in 3 different activity types',verifyType:'count',   targetValue:3,  buddyRequired:false, xpReward:175 },
  { stationNum:5, title:'The Streak',      description:'Train for 7 consecutive days',                  verifyType:'streak',   targetValue:7,  buddyRequired:false, xpReward:300 },
  { stationNum:6, title:'The Trusted',     description:'Zero missed sessions and trust score ≥ 70',     verifyType:'trust',    targetValue:70, buddyRequired:false, xpReward:400 },
  { stationNum:7, title:'The Recruiter',   description:'Refer 1 person who completes Station 1',        verifyType:'referral', targetValue:1,  buddyRequired:false, xpReward:250 },
  { stationNum:8, title:'The Finisher',    description:'Complete all Stations 1 through 7',             verifyType:'count',    targetValue:7,  buddyRequired:false, xpReward:800 },
];

async function main() {
  const now   = new Date();
  const end30 = new Date(now.getTime() + 30 * 86400000);
  const end60 = new Date(now.getTime() + 60 * 86400000);

  // 1. January Pack — Tier 2 Pack Event (the main one)
  const pack = await prisma.challenge.upsert({
    where:  { id: 'a1b2c3d4-0001-4000-8000-000000000001' },
    update: {},
    create: {
      id:                 'a1b2c3d4-0001-4000-8000-000000000001',
      title:              'The January Pack',
      description:        '8 stations. 30 days. Complete them all to earn the Seshlly trophy.',
      type:               'pack',
      tier:               2,
      activityType:       'any',
      activityTag:        '🏅 Any activity',
      environment:        'any',
      startAt:            now,
      endAt:              end30,
      xpPool:             2475,
      entryLevelRequired: 1,
      trustRequired:      0,
      isActive:           true,
      stations:           { create: HYROX_STATIONS },
    },
  });
  console.log('✓ Pack Event created:', pack.title);

  // 2. Morning 30 — Tier 1 Solo Sprint (no level requirement)
  const solo = await prisma.challenge.upsert({
    where:  { id: 'a1b2c3d4-0002-4000-8000-000000000002' },
    update: {},
    create: {
      id:          'a1b2c3d4-0002-4000-8000-000000000002',
      title:       'Morning 30',
      description: 'Complete 30 training sessions before 7am this month. No buddy needed.',
      type:        'solo',
      tier:        1,
      activityType: 'any',
      activityTag:  '🏅 Any activity',
      environment:  'any',
      startAt:     now,
      endAt:       end30,
      xpPool:      400,
      entryLevelRequired: 1,
      trustRequired:      0,
      isActive:    true,
      stations: {
        create: [
          { stationNum:1, title:'10 Early Sessions',  description:'Complete 10 sessions before 7am', verifyType:'count', targetValue:10, buddyRequired:false, xpReward:100 },
          { stationNum:2, title:'20 Early Sessions',  description:'Complete 20 sessions before 7am', verifyType:'count', targetValue:20, buddyRequired:false, xpReward:150 },
          { stationNum:3, title:'Morning Champion',   description:'Complete 30 sessions before 7am', verifyType:'count', targetValue:30, buddyRequired:false, xpReward:150 },
        ],
      },
    },
  });
  console.log('✓ Solo Sprint created:', solo.title);

  // 3. Buddy Duel — Tier 2 Duel
  const duel = await prisma.challenge.upsert({
    where:  { id: 'a1b2c3d4-0003-4000-8000-000000000003' },
    update: {},
    create: {
      id:          'a1b2c3d4-0003-4000-8000-000000000003',
      title:       'The Duel',
      description: 'Challenge a buddy head-to-head. Most sessions in 30 days wins +bonus XP.',
      type:        'duel',
      tier:        2,
      activityType: 'any',
      activityTag:  '🏅 Any activity',
      environment:  'any',
      startAt:     now,
      endAt:       end60,
      xpPool:      600,
      entryLevelRequired: 3,
      trustRequired:      40,
      isActive:    true,
      stations: {
        create: [
          { stationNum:1, title:'First 5',   description:'Complete 5 sessions together', verifyType:'count', targetValue:5,  buddyRequired:true, xpReward:200 },
          { stationNum:2, title:'First 10',  description:'Complete 10 sessions together',verifyType:'count', targetValue:10, buddyRequired:true, xpReward:400 },
        ],
      },
    },
  });
  console.log('✓ Buddy Duel created:', duel.title);

  console.log('\n✅ Done. Open the Seshlly app and tap Challenges — all 3 will now show.');
}

main()
  .catch(e => { console.error('❌ Seed failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
