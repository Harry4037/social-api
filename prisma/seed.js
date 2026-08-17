// ─────────────────────────────────────────────────────────
//  seeder.js — Seshlly Master Seeder
//  Run: node seeder.js
//  Seeds: Super Admin + subscription plans + SEO + CMS data
// ─────────────────────────────────────────────────────────
const { PrismaClient } = require('@prisma/client');
const bcrypt           = require('bcryptjs');
const { v4: uuid }     = require('uuid');
const prisma           = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Seshlly database...\n');

  // ── 1. Super Admin ─────────────────────────────────────
  console.log('1. Creating Super Admin...');
  const passwordHash = await bcrypt.hash('Admin@123456', 12);

  const admin = await prisma.adminUser.upsert({
    where:  { email: 'admin@seshlly.com' },
    update: {
      passwordHash,
      role:     'super_admin',
      status:   'active',
      isActive: true,
      name:     'Super Admin',
      firstName:'Super',
      lastName: 'Admin',
    },
    create: {
      id:           uuid(),
      email:        'admin@seshlly.com',
      passwordHash,
      firstName:    'Super',
      lastName:     'Admin',
      name:         'Super Admin',
      role:         'super_admin',
      status:       'active',
      isActive:     true,
    },
  });
  console.log(`   ✅ Admin: ${admin.email} / Admin@123456`);

  // Super admin ko full permissions
  await prisma.adminPermission.upsert({
    where:  { adminId: admin.id },
    update: {
      blogView: true, blogCreate: true, blogEdit: true,
      blogDelete: true, blogPublish: true,
      seoView: true, seoEditMeta: true, seoEditFaq: true, seoSitemap: true,
      contentView: true, contentHero: true, contentStats: true, contentTestimon: true,
      socialView: true, socialEdit: true,
      appUsersView: true, appUsersBan: true,
      challengesView: true, challengesCreate: true, challengesEdit: true,
    },
    create: {
      id: uuid(), adminId: admin.id,
      blogView: true, blogCreate: true, blogEdit: true,
      blogDelete: true, blogPublish: true,
      seoView: true, seoEditMeta: true, seoEditFaq: true, seoSitemap: true,
      contentView: true, contentHero: true, contentStats: true, contentTestimon: true,
      socialView: true, socialEdit: true,
      appUsersView: true, appUsersBan: true,
      challengesView: true, challengesCreate: true, challengesEdit: true,
    },
  });
  console.log('   ✅ Super Admin permissions set\n');

  // ── 2. Subscription Plans ──────────────────────────────
  console.log('2. Creating subscription plans...');
  const plans = [
    {
      slug: 'free', name: 'Free', price: 0, interval: 'monthly',
      features: JSON.stringify([
        '10 swipes/day', '20 chat tokens', '10km match radius',
        'View influencer profiles', 'Basic challenges',
      ]),
      isPopular: false,
    },
    {
      slug: 'pro', name: 'Pro', price: 249, interval: 'monthly',
      features: JSON.stringify([
        'Unlimited swipes', '100 tokens on join + 50/month',
        '50km match radius', 'Priority matching',
        'Early challenge access', 'Streak freeze 1/month',
      ]),
      isPopular: true,
    },
    {
      slug: 'elite', name: 'Elite', price: 599, interval: 'monthly',
      features: JSON.stringify([
        'Unlimited swipes', '200 tokens on join + 100/month',
        '100km match radius', 'Full influencer access',
        'Book up to 3 sessions/month per influencer',
        'Priority matching', 'Elite profile badge',
      ]),
      isPopular: false,
    },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlanConfig.upsert({
      where:  { slug: plan.slug },
      update: { price: plan.price, features: plan.features, isPopular: plan.isPopular },
      create: { id: uuid(), ...plan },
    });
    console.log(`   ✅ Plan: ${plan.name} — ₹${plan.price}/month`);
  }

  // ── 3. SEO Pages ──────────────────────────────────────
  console.log('\n3. Creating SEO pages...');
  const seoPages = [
    {
      pageKey:  'home',
      pageUrl:  'https://seshlly.com',
      metaTitle:'Seshlly — Find Your Workout Buddy | India\'s Fitness Partner App',
      metaDesc: 'Match with fitness partners near you. Schedule sessions, complete challenges, and never train alone again. Download Seshlly free on iOS and Android.',
      hreflang: 'en-IN',
    },
    {
      pageKey:  'blog',
      pageUrl:  'https://seshlly.com/blog',
      metaTitle:'Blog — Seshlly Fitness Stories & Tips',
      metaDesc: 'Real member stories, fitness industry insights, challenge updates and more from the Seshlly community.',
      hreflang: 'en-IN',
    },
    {
      pageKey:  'download',
      pageUrl:  'https://seshlly.com/download',
      metaTitle:'Download Seshlly Free — iOS & Android',
      metaDesc: 'Download Seshlly on iOS and Android. Find workout buddies, schedule sessions and join fitness challenges. Free to download.',
      hreflang: 'en-IN',
    },
    {
      pageKey:  'blog_post',
      pageUrl:  'https://seshlly.com/blog/*',
      metaTitle:'Blog Post — Seshlly',
      metaDesc: 'Read the latest fitness stories and tips from the Seshlly community.',
      hreflang: 'en-IN',
    },
  ];

  for (const page of seoPages) {
    await prisma.seoPage.upsert({
      where:  { pageKey: page.pageKey },
      update: { metaTitle: page.metaTitle, metaDesc: page.metaDesc },
      create: { id: uuid(), ...page },
    });
    console.log(`   ✅ SEO: ${page.pageKey}`);
  }

  // ── 4. SEO FAQs (for home page) ───────────────────────
  console.log('\n4. Creating SEO FAQs...');
  const homePage = await prisma.seoPage.findUnique({ where: { pageKey: 'home' } });
  if (homePage) {
    const existingFaqs = await prisma.seoFaq.count({ where: { pageId: homePage.id } });
    if (existingFaqs === 0) {
      const faqs = [
        {
          question: 'How does Seshlly match workout buddies?',
          answer:   'Seshlly matches you based on activity type, fitness level, location, schedule and goals. Swipe through nearby profiles and connect with people who train at the same time and place.',
          order: 1,
        },
        {
          question: 'Is Seshlly free to use?',
          answer:   'Yes, Seshlly is free to download. You get 20 chat tokens monthly, unlimited matching, session scheduling and access to challenges. Pro and Elite plans available for more features.',
          order: 2,
        },
        {
          question: 'How do I book a session on Seshlly?',
          answer:   'Once matched, go to Sessions and tap +. Choose activity, date, time and duration. Your buddy gets an invite in chat and confirms instantly. Both users get notified.',
          order: 3,
        },
        {
          question: 'What is Trust Score on Seshlly?',
          answer:   'Trust Score is your reliability rating (0-100). It increases when you complete sessions and upload proof. Higher Trust Score means better quality matches.',
          order: 4,
        },
        {
          question: 'What is the Elite plan on Seshlly?',
          answer:   'The Elite plan (₹599/month) gives you access to verified fitness influencers, unlimited swipes, 200 tokens, and 100km match radius. You can book up to 3 sessions per month with each influencer.',
          order: 5,
        },
      ];

      for (const faq of faqs) {
        await prisma.seoFaq.create({ data: { id: uuid(), pageId: homePage.id, ...faq } });
      }
      console.log(`   ✅ Created ${faqs.length} FAQs for home page`);
    } else {
      console.log(`   ⏭️  FAQs already exist (${existingFaqs})`);
    }
  }

  // ── 5. Website Content ─────────────────────────────────
  console.log('\n5. Creating website content...');
  const contentItems = [
    { key: 'hero_badge',  value: '🇮🇳 India\'s fitness buddy app' },
    { key: 'hero_line1',  value: 'Train harder.' },
    { key: 'hero_line2',  value: 'Together.' },
    { key: 'hero_sub',    value: 'Match with workout partners near you. Schedule sessions, complete challenges, and never skip a gym day again.' },
    { key: 'stat_1_value',value: '50K+' },
    { key: 'stat_1_label',value: 'Active users' },
    { key: 'stat_2_value',value: '2.1L+' },
    { key: 'stat_2_label',value: 'Sessions done' },
    { key: 'stat_3_value',value: '98%' },
    { key: 'stat_3_label',value: 'Match success' },
    { key: 'stat_4_value',value: '4.8★' },
    { key: 'stat_4_label',value: 'App rating' },
  ];

  for (const item of contentItems) {
    await prisma.websiteContent.upsert({
      where:  { key: item.key },
      update: {},              // Don't overwrite if exists
      create: { id: uuid(), ...item },
    });
  }
  console.log(`   ✅ Created ${contentItems.length} content items`);

  // ── 6. Social Links ────────────────────────────────────
  console.log('\n6. Creating social links...');
  const socialLinks = [
    { key: 'instagram',     label: 'Instagram',     url: 'https://instagram.com/seshlly' },
    { key: 'facebook',      label: 'Facebook',      url: 'https://facebook.com/seshlly' },
    { key: 'app_store',     label: 'App Store',     url: '' },
    { key: 'play_store',    label: 'Google Play',   url: '' },
    { key: 'support_email', label: 'Support Email', url: 'support@seshlly.com' },
    { key: 'stories_email', label: 'Stories Email', url: 'stories@seshlly.com' },
  ];

  for (const link of socialLinks) {
    await prisma.socialLink.upsert({
      where:  { key: link.key },
      update: {},
      create: { id: uuid(), ...link },
    });
  }
  console.log(`   ✅ Created ${socialLinks.length} social links`);

  // ── Done ───────────────────────────────────────────────
  console.log('\n' + '═'.repeat(50));
  console.log('✅ SEEDING COMPLETE\n');
  console.log('Admin Login:');
  console.log('  Email:    admin@seshlly.com');
  console.log('  Password: Admin@123456');
  console.log('\n⚠️  CHANGE THE PASSWORD after first login!');
  console.log('═'.repeat(50));
}

main()
  .catch(e => { console.error('❌ Seeder failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
