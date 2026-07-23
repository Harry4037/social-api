'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const now   = new Date();
  const end30 = new Date(now.getTime() + 30 * 86400000);

  await prisma.challenge.upsert({
    where:  { id: 'seshlly-solo-the-grind' },
    update: {},
    create: {
      id: 'seshlly-solo-the-grind', title: 'The Grind',
      description: '7 stations. 30 days. No shortcuts. Are you the 2% who finish?',
      type: 'solo', tier: 2, startAt: now, endAt: end30,
      xpPool: 2850, entryLevelRequired: 3, trustRequired: 50, isActive: true,
      stations: { create: [
        { stationNum:1, title:'The Grind Starts',  description:'Complete 15 sessions in 30 days. Proof within 8 hours each time.',               verifyType:'count',  targetValue:15, buddyRequired:false, xpReward:250  },
        { stationNum:2, title:'The Early Riser',   description:'Complete 5 sessions with proof uploaded before 6:00 AM.',                        verifyType:'count',  targetValue:5,  buddyRequired:false, xpReward:200  },
        { stationNum:3, title:'The Streak',        description:'Maintain a 10-day consecutive training streak. Any missed day resets to zero.',   verifyType:'streak', targetValue:10, buddyRequired:false, xpReward:350  },
        { stationNum:4, title:'The Diverse',       description:'Complete sessions across 4 different activity types with proof for each.',         verifyType:'count',  targetValue:4,  buddyRequired:false, xpReward:150  },
        { stationNum:5, title:'The Veteran',       description:'Complete 20 total sessions with proof — every 1.5 days for 30 days.',             verifyType:'count',  targetValue:20, buddyRequired:false, xpReward:400  },
        { stationNum:6, title:'The Consistent',    description:'Zero missed proof windows in the last 14 days AND trust score >= 75.',            verifyType:'trust',  targetValue:75, buddyRequired:false, xpReward:500  },
        { stationNum:7, title:'The Finisher',      description:'Complete all Stations 1 through 6. You are the 2%.',                             verifyType:'count',  targetValue:6,  buddyRequired:false, xpReward:1000 },
      ]},
    },
  });
  console.log('✓ The Grind (Solo) — 2/100 finish target');

  await prisma.challenge.upsert({
    where:  { id: 'seshlly-buddy-the-bond' },
    update: {},
    create: {
      id: 'seshlly-buddy-the-bond', title: 'The Bond',
      description: 'Two people. Collab proofs only. If one quits, both lose. ~2 pairs per 100 finish.',
      type: 'duel', tier: 2, startAt: now, endAt: end30,
      xpPool: 5500, entryLevelRequired: 3, trustRequired: 50, isActive: true,
      stations: { create: [
        { stationNum:1, title:'The Pair',        description:'Complete 10 sessions together. Both upload collab proof within 8 hours.',                                           verifyType:'count',  targetValue:10, buddyRequired:true,  xpReward:200  },
        { stationNum:2, title:'The Duo Streak',  description:"Both maintain a 7-day streak simultaneously. One person's rest day breaks it for both.",                           verifyType:'streak', targetValue:7,  buddyRequired:true,  xpReward:300  },
        { stationNum:3, title:'The Loyalists',   description:'Complete 15 sessions together with collab proofs. Both must upload within 8 hours of each shared session.',        verifyType:'count',  targetValue:15, buddyRequired:true,  xpReward:400  },
        { stationNum:4, title:'The Early Pair',  description:'Complete 3 collab sessions with both proofs submitted before 6:30 AM.',                                             verifyType:'count',  targetValue:3,  buddyRequired:true,  xpReward:250  },
        { stationNum:5, title:'The Champions',   description:'Both users must independently complete 20 total sessions (includes solo training days).',                           verifyType:'count',  targetValue:20, buddyRequired:false, xpReward:600  },
        { stationNum:6, title:'The Bond',        description:'Complete all S1-S5 AND both users must have trust score >= 75. Earn the Buddy Trophy together.',                   verifyType:'trust',  targetValue:75, buddyRequired:true,  xpReward:1000 },
      ]},
    },
  });
  console.log('✓ The Bond (Buddy) — 2/100 pairs finish target');

  console.log('\n✅ Both challenges live. Open the app → Challenges tab.');
  console.log('   The Grind  — 7 stations · 2,850 XP · ~2/100 finish → Level 7 Legend');
  console.log('   The Bond   — 6 stations · 2,750 XP each · ~2/100 pairs → Level 7 Legend\n');
}

main()
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
