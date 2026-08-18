'use strict';
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱  Seeding database…');

  // ── Subscription Plans ─────────────────────────────────
  const plans = [
    {
      id: uuid(), slug: 'free', name: 'Free',
      description: 'Get started — limited swipes',
      price: 0, interval: 'monthly', isPopular: false,
      features: JSON.stringify(['5 swipes/day','Basic matching','Chat with tokens']),
    },
    {
      id: uuid(), slug: 'pro', name: 'Pro',
      description: 'Serious trainers only',
      price: 29900, interval: 'monthly', isPopular: true,
      features: JSON.stringify(['Unlimited swipes','Priority matching','20 tokens/month','Pro badge','See who liked you']),
    },
    {
      id: uuid(), slug: 'elite', name: 'Elite',
      description: 'The full FitConnect experience',
      price: 59900, interval: 'monthly', isPopular: false,
      features: JSON.stringify(['Everything in Pro','Influencer profile','Advanced analytics','Custom gym badge','50 tokens/month','Priority support']),
    },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlanConfig.upsert({
      where: { slug: plan.slug },
      update: {},
      create: { ...plan, features: plan.features },
    });
  }

  // ── Demo Users ─────────────────────────────────────────
  const hash = await bcrypt.hash('Ankit@123', 12);

  const users = [
    {
      id: uuid(), email: 'hariom4037@gmail.com',
      firstName: 'Ankit', lastName: 'Gangwar',
      username: 'ankit', city: 'Bareilly',
      primaryActivity: 'gym', experienceLevel: 'advanced',
      activities: JSON.stringify(['gym','running','crossfit']),
      goals: JSON.stringify(['muscle_gain','strength']),
      xpTotal: 1200, level: 5, chatTokens: 25,
      trustScore: 82.5, idVerified: true,
      subscriptionPlan: 'pro',
      bio: 'Powerlifter | 5AM club | Looking for accountability partners 💪',
      latitude: 19.0760, longitude: 72.8777,
    },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash: hash },
    });
  }

  console.log(`✅  Seeded ${plans.length} plans + ${users.length} demo users`);
  console.log('   Demo login: hariom4037@gmail.com / Ankit@123');

  // ── Super Admin ────────────────────────────────────────
  const adminHash = await bcrypt.hash('QWERTYZXCV', 12);
  const admins = [
    { email: 'superadmin@seshlly.com', firstName: 'Super', lastName: 'Admin', role: 'SUPER_ADMIN' },
    { email: 'admin@seshlly.com',      firstName: 'Admin', lastName: 'User',  role: 'ADMIN'       },
    { email: 'mod@seshlly.com',        firstName: 'Mod',   lastName: 'User',  role: 'MODERATOR'   },
    { email: 'analyst@seshlly.com',    firstName: 'Data',  lastName: 'Analyst',role:'ANALYST'     },
  ];
  for (const a of admins) {
    await prisma.adminUser.upsert({
      where:  { email: a.email },
      update: {},
      create: { id: uuid(), ...a, passwordHash: adminHash },
    });
  }
  console.log(`✅  Seeded ${admins.length} admin accounts`);
  console.log('   Admin login: superadmin@fitconnect.com / Admin@123456');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
