'use strict';
const admin = require('../config/firebase');
const prisma = require('../config/db');

// 25 Templates
const TEMPLATES = {
  // Match & Chat
  match_new: (d) => ({ title: "🎉 It's a Match!", body: `You matched with ${d.name}! Say hello` }),
  message_new: (d) => ({ title: d.name, body: d.preview }),
  match_request: (d) => ({ title: 'New Match Request', body: `${d.name} wants to train with you` }),
  super_like: (d) => ({ title: '⭐ Super Like!', body: `${d.name} super liked you!` }),

  // Session
  session_invite: (d) => ({ title: 'Session Invite 🏋️', body: `${d.name} invited you to train` }),
  session_confirmed: (d) => ({ title: 'Session Confirmed 💪', body: `${d.name} confirmed your session` }),
  session_reminder: (d) => ({ title: 'Session in 1 hour ⏰', body: `${d.name} is waiting for you` }),
  session_missed: (d) => ({ title: 'Session Missed 😔', body: 'Trust -5, Token -1. Show up next time!' }),
  session_proof: (d) => ({ title: 'Proof Uploaded 📸', body: `${d.name} uploaded proof — confirm now` }),

  // Flash & Streak
  flash_received: (d) => ({ title: '🏋️ Sesh Flash!', body: `${d.name} sent you a Flash — tap to view` }),
  flash_streak_warn: (d) => ({ title: '🔥 Streak at risk!', body: `Send a Flash to ${d.name} to keep your streak` }),
  flash_milestone: (d) => ({ title: `🔥 ${d.days} Day Streak!`, body: `You and ${d.name} are on fire!` }),
  flash_broken: (d) => ({ title: 'Streak Broken 😔', body: `Your streak with ${d.name} has ended. Start again!` }),

  // XP & Levels
  level_up: (d) => ({ title: `🎉 Level ${d.level} — ${d.levelName}!`, body: 'You unlocked new perks!' }),
  xp_weekly: (d) => ({ title: 'Weekly XP Summary 💪', body: `${d.xp} XP earned — #${d.rank} in ${d.city}` }),
  challenge_done: (d) => ({ title: '🏆 Challenge Complete!', body: `+${d.xp} XP earned. Amazing work!` }),

  // Tokens & Subscription
  token_low: (d) => ({ title: '⚠️ Tokens Running Low', body: `Only ${d.count} tokens left` }),
  token_empty: (d) => ({ title: 'No Tokens Left', body: 'Upgrade to Pro for unlimited chat' }),
  subscription_exp: (d) => ({ title: 'Pro Expiring Soon', body: `Your Pro plan expires in ${d.days} days` }),
  referral_success: (d) => ({ title: '🎁 Referral Bonus!', body: `${d.name} joined! +50 tokens added` }),

  // Re-engagement
  inactive_3d: (d) => ({ title: `${d.name} misses you 👀`, body: 'They sent you a Flash!' }),
  inactive_7d: (d) => ({ title: '🔥 Streak at risk!', body: "Don't let your streak break!" }),
  inactive_30d: (d) => ({ title: 'Come back! 💪', body: `5 new buddies near you in ${d.city}` }),

  // Verification
  id_verified: (d) => ({ title: '✅ ID Verified!', body: 'Trust Score +10. Your profile is now verified' }),
  influencer_approved: (d) => ({ title: '🌟 You\'re an Influencer!', body: 'Your application has been approved' }),
};

/**
 * Send push notification to a user
 * @param {string} userId
 * @param {string} type - template key
 * @param {object} data - template variables
 * @param {object} extra - deepLink, imageUrl etc
 */
const send = async (userId, type, data = {}, extra = {}) => {
  try {
    // Get user FCM token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true, firstName: true },
    });

    if (!user?.fcmToken) return; // No token — skip

    // Get template
    const tmpl = TEMPLATES[type];
    if (!tmpl) {
      console.error(`[FCM] Unknown template: ${type}`);
      return;
    }

    const { title, body } = tmpl(data);

    // Build FCM message
    const message = {
      token: user.fcmToken,
      notification: { title, body },
      data: {
        type,
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        ...(extra.deepLink ? { deepLink: extra.deepLink } : {}),
      },
      android: {
        notification: {
          channelId: 'seshlly_default',
          priority: 'high',
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    await admin.messaging().send(message);

    // Save to in-app notifications table
    await prisma.notification.create({
      data: {
        id: require('crypto').randomUUID(),
        userId,
        type,
        title,
        message: body,
        data: JSON.stringify(data),
        isRead: false,
      },
    });

  } catch (e) {
    console.error(`[FCM] send error (${type}):`, e.message);
  }
};

/**
 * Send to multiple users
 */
const sendMany = async (userIds, type, data = {}) => {
  await Promise.allSettled(
    userIds.map(id => send(id, type, data))
  );
};

module.exports = { send, sendMany, TEMPLATES };