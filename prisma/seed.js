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
  const hash = await bcrypt.hash('Test@1234', 12);

  const users = [
    {
      id: uuid(), email: 'alex@demo.com',
      firstName: 'Alex', lastName: 'Rivera',
      username: 'alex_lifts', city: 'Mumbai',
      primaryActivity: 'gym', experienceLevel: 'advanced',
      activities: JSON.stringify(['gym','running','crossfit']),
      goals: JSON.stringify(['muscle_gain','strength']),
      xpTotal: 1200, level: 5, chatTokens: 25,
      trustScore: 82.5, idVerified: true,
      subscriptionPlan: 'pro',
      bio: 'Powerlifter | 5AM club | Looking for accountability partners 💪',
      latitude: 19.0760, longitude: 72.8777,
    },
    {
      id: uuid(), email: 'priya@demo.com',
      firstName: 'Priya', lastName: 'Sharma',
      username: 'priya_yoga', city: 'Delhi',
      primaryActivity: 'yoga', experienceLevel: 'intermediate',
      activities: JSON.stringify(['yoga','running']),
      goals: JSON.stringify(['flexibility','general_fit']),
      xpTotal: 640, level: 3, chatTokens: 18,
      trustScore: 76.0, idVerified: true,
      subscriptionPlan: 'free',
      bio: 'Yoga instructor | Marathon runner | Healthy living advocate',
      latitude: 28.7041, longitude: 77.1025,
    },
    {
      id: uuid(), email: 'rahul@demo.com',
      firstName: 'Rahul', lastName: 'Gupta',
      username: 'rahul_crossfit', city: 'Bangalore',
      primaryActivity: 'crossfit', experienceLevel: 'elite',
      activities: JSON.stringify(['crossfit','boxing','hyrox']),
      goals: JSON.stringify(['competition','endurance','strength']),
      xpTotal: 3400, level: 7, chatTokens: 50,
      trustScore: 91.0, idVerified: true,
      subscriptionPlan: 'elite',
      isInfluencer: true, instagramHandle: '@rahul_crossfit', instagramFollowers: 12000,
      bio: 'CrossFit L2 Coach | Hyrox athlete | Come train with me!',
      latitude: 12.9716, longitude: 77.5946,
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
  console.log('   Demo login: alex@demo.com / Test@1234');

  // ── Super Admin ────────────────────────────────────────
  const adminHash = await bcrypt.hash('Admin@123456', 12);
  const admins = [
    { email: 'superadmin@fitconnect.com', firstName: 'Super', lastName: 'Admin', role: 'SUPER_ADMIN' },
    { email: 'admin@fitconnect.com',      firstName: 'Admin', lastName: 'User',  role: 'ADMIN'       },
    { email: 'mod@fitconnect.com',        firstName: 'Mod',   lastName: 'User',  role: 'MODERATOR'   },
    { email: 'analyst@fitconnect.com',    firstName: 'Data',  lastName: 'Analyst',role:'ANALYST'     },
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
