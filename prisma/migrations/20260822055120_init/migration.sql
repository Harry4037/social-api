-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `avatarUrl` TEXT NULL,
    `bio` TEXT NULL,
    `country` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `latitude` DECIMAL(10, 8) NULL,
    `longitude` DECIMAL(11, 8) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'BANNED', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `isBanned` BOOLEAN NOT NULL DEFAULT false,
    `loginCount` INTEGER NOT NULL DEFAULT 0,
    `lastLoginAt` DATETIME(3) NULL,
    `lastActiveAt` DATETIME(3) NULL,
    `gender` VARCHAR(191) NULL,
    `walkthroughSeen` BOOLEAN NOT NULL DEFAULT false,
    `primaryActivity` VARCHAR(191) NULL,
    `activities` JSON NOT NULL,
    `experienceLevel` VARCHAR(191) NULL,
    `goals` JSON NOT NULL,
    `primaryGym` VARCHAR(191) NULL,
    `searchRadius` INTEGER NOT NULL DEFAULT 10,
    `xpTotal` INTEGER NOT NULL DEFAULT 0,
    `weeklyXp` INTEGER NOT NULL DEFAULT 0,
    `monthlyXp` INTEGER NOT NULL DEFAULT 0,
    `level` INTEGER NOT NULL DEFAULT 1,
    `chatTokens` INTEGER NOT NULL DEFAULT 20,
    `trustScore` DECIMAL(5, 2) NOT NULL DEFAULT 30.00,
    `idVerified` BOOLEAN NOT NULL DEFAULT false,
    `isInfluencer` BOOLEAN NOT NULL DEFAULT false,
    `instagramHandle` VARCHAR(191) NULL,
    `instagramFollowers` INTEGER NULL,
    `influencerBio` TEXT NULL,
    `instagramVerifiedAt` DATETIME(3) NULL,
    `influencerAppliedAt` DATETIME(3) NULL,
    `influencerSessionLimit` INTEGER NOT NULL DEFAULT 3,
    `subscriptionPlan` ENUM('free', 'pro', 'elite') NOT NULL DEFAULT 'free',
    `subscriptionExpiry` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_email_idx`(`email`),
    INDEX `users_city_idx`(`city`),
    INDEX `users_latitude_longitude_idx`(`latitude`, `longitude`),
    INDEX `users_subscriptionPlan_idx`(`subscriptionPlan`),
    INDEX `users_primaryActivity_idx`(`primaryActivity`),
    INDEX `users_isInfluencer_idx`(`isInfluencer`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(500) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_key`(`token`),
    INDEX `refresh_tokens_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `swipes` (
    `id` VARCHAR(191) NOT NULL,
    `swiperId` VARCHAR(191) NOT NULL,
    `swipedId` VARCHAR(191) NOT NULL,
    `action` ENUM('like', 'skip', 'super_like') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `swipes_swiperId_idx`(`swiperId`),
    INDEX `swipes_swipedId_idx`(`swipedId`),
    UNIQUE INDEX `swipes_swiperId_swipedId_key`(`swiperId`, `swipedId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `matches` (
    `id` VARCHAR(191) NOT NULL,
    `userAId` VARCHAR(191) NOT NULL,
    `userBId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `buddyStrikeStreak` INTEGER NOT NULL DEFAULT 0,
    `strikeCount` INTEGER NOT NULL DEFAULT 0,
    `lastStrikeAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `matches_userAId_idx`(`userAId`),
    INDEX `matches_userBId_idx`(`userBId`),
    UNIQUE INDEX `matches_userAId_userBId_key`(`userAId`, `userBId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workout_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `buddyId` VARCHAR(191) NULL,
    `activity` VARCHAR(191) NOT NULL,
    `gymName` VARCHAR(191) NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `durationMins` INTEGER NOT NULL DEFAULT 60,
    `endTime` DATETIME(3) NOT NULL,
    `status` ENUM('scheduled', 'completed', 'missed') NOT NULL DEFAULT 'scheduled',
    `proofImageUrl` TEXT NULL,
    `proofVideoUrl` TEXT NULL,
    `proofUploadedAt` DATETIME(3) NULL,
    `xpEarned` INTEGER NULL,
    `tokensDeducted` INTEGER NULL,
    `notes` TEXT NULL,
    `incompleteReason` VARCHAR(191) NULL,
    `challengeId` VARCHAR(191) NULL,
    `chatId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `workout_sessions_userId_idx`(`userId`),
    INDEX `workout_sessions_buddyId_idx`(`buddyId`),
    INDEX `workout_sessions_status_idx`(`status`),
    INDEX `workout_sessions_scheduledAt_idx`(`scheduledAt`),
    INDEX `workout_sessions_endTime_idx`(`endTime`),
    INDEX `workout_sessions_challengeId_idx`(`challengeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `session_participants` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `session_participants_sessionId_idx`(`sessionId`),
    INDEX `session_participants_userId_idx`(`userId`),
    UNIQUE INDEX `session_participants_sessionId_userId_key`(`sessionId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chats` (
    `id` VARCHAR(191) NOT NULL,
    `matchId` VARCHAR(191) NULL,
    `userAId` VARCHAR(191) NULL,
    `userBId` VARCHAR(191) NULL,
    `isGroup` BOOLEAN NOT NULL DEFAULT false,
    `groupName` VARCHAR(191) NULL,
    `lastMessage` TEXT NULL,
    `lastMessageAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `chats_matchId_key`(`matchId`),
    INDEX `chats_userAId_idx`(`userAId`),
    INDEX `chats_userBId_idx`(`userBId`),
    INDEX `chats_isGroup_idx`(`isGroup`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_members` (
    `id` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isAdmin` BOOLEAN NOT NULL DEFAULT false,

    INDEX `chat_members_chatId_idx`(`chatId`),
    INDEX `chat_members_userId_idx`(`userId`),
    UNIQUE INDEX `chat_members_chatId_userId_key`(`chatId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `type` ENUM('text', 'image', 'session_invite', 'proof', 'system') NOT NULL DEFAULT 'text',
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `messages_chatId_idx`(`chatId`),
    INDEX `messages_senderId_idx`(`senderId`),
    INDEX `messages_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('match', 'session', 'proof', 'chat', 'token', 'xp', 'payment', 'subscription', 'system') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `actionUrl` VARCHAR(191) NULL,
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_idx`(`userId`),
    INDEX `notifications_isRead_idx`(`isRead`),
    INDEX `notifications_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_plans` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `price` INTEGER NOT NULL,
    `interval` VARCHAR(191) NOT NULL,
    `features` JSON NOT NULL,
    `isPopular` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscription_plans_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NULL,
    `razorpayOrderId` VARCHAR(191) NOT NULL,
    `razorpayPaymentId` VARCHAR(191) NULL,
    `razorpaySignature` VARCHAR(191) NULL,
    `amount` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    `status` VARCHAR(191) NOT NULL DEFAULT 'created',
    `type` VARCHAR(191) NOT NULL DEFAULT 'subscription',
    `tokenPack` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_razorpayOrderId_key`(`razorpayOrderId`),
    INDEX `orders_userId_idx`(`userId`),
    INDEX `orders_razorpayOrderId_idx`(`razorpayOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `uploads` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `folder` ENUM('avatars', 'proofs', 'covers') NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `mimeType` VARCHAR(191) NULL,
    `sizeBytes` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `uploads_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_swipes` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,

    INDEX `daily_swipes_userId_idx`(`userId`),
    UNIQUE INDEX `daily_swipes_userId_date_key`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `xp_events` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `xpAmount` INTEGER NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `xp_events_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `name` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'custom',
    `avatarUrl` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `invitedBy` VARCHAR(191) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `lastActiveAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `details` JSON NULL,
    `ip` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_adminId_idx`(`adminId`),
    INDEX `audit_logs_action_idx`(`action`),
    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `challenges` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `tier` INTEGER NOT NULL DEFAULT 1,
    `activityType` VARCHAR(191) NOT NULL DEFAULT 'any',
    `activityTag` VARCHAR(191) NOT NULL DEFAULT 'Any activity',
    `environment` VARCHAR(191) NOT NULL DEFAULT 'any',
    `cityId` VARCHAR(191) NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `xpPool` INTEGER NOT NULL,
    `entryLevelRequired` INTEGER NOT NULL DEFAULT 1,
    `trustRequired` INTEGER NOT NULL DEFAULT 0,
    `maxParticipants` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `challenges_tier_idx`(`tier`),
    INDEX `challenges_type_idx`(`type`),
    INDEX `challenges_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `challenge_stations` (
    `id` VARCHAR(191) NOT NULL,
    `challengeId` VARCHAR(191) NOT NULL,
    `stationNum` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `exerciseName` VARCHAR(191) NOT NULL DEFAULT '',
    `setsReps` VARCHAR(191) NOT NULL DEFAULT '',
    `proofInstruction` VARCHAR(191) NOT NULL DEFAULT 'Upload a photo or video of your workout',
    `verifyType` VARCHAR(191) NOT NULL DEFAULT 'count',
    `targetValue` INTEGER NOT NULL DEFAULT 1,
    `buddyRequired` BOOLEAN NOT NULL DEFAULT false,
    `xpReward` INTEGER NOT NULL,

    INDEX `challenge_stations_challengeId_idx`(`challengeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `challenge_entries` (
    `id` VARCHAR(191) NOT NULL,
    `challengeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `buddyId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `currentStation` INTEGER NOT NULL DEFAULT 1,
    `totalXpEarned` INTEGER NOT NULL DEFAULT 0,
    `rankCity` INTEGER NULL,
    `rankGlobal` INTEGER NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSessionAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `challenge_entries_challengeId_idx`(`challengeId`),
    INDEX `challenge_entries_userId_idx`(`userId`),
    INDEX `challenge_entries_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `station_completions` (
    `id` VARCHAR(191) NOT NULL,
    `entryId` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `stationNum` INTEGER NOT NULL,
    `completedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `xpAwarded` INTEGER NOT NULL,
    `progressValue` INTEGER NOT NULL DEFAULT 0,
    `isCollab` BOOLEAN NOT NULL DEFAULT false,

    INDEX `station_completions_entryId_idx`(`entryId`),
    INDEX `station_completions_stationId_idx`(`stationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `challenge_feed_posts` (
    `id` VARCHAR(191) NOT NULL,
    `challengeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `stationNum` INTEGER NOT NULL,
    `stationTitle` VARCHAR(191) NOT NULL,
    `postedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `xpAwarded` INTEGER NOT NULL,
    `proofImageUrl` TEXT NULL,
    `isCollab` BOOLEAN NOT NULL DEFAULT false,
    `collabUserId` VARCHAR(191) NULL,
    `collabUserName` VARCHAR(191) NULL,
    `collabAvatarUrl` TEXT NULL,
    `activitySlug` VARCHAR(191) NULL,
    `caption` TEXT NULL,
    `groupPhotoUrl` TEXT NULL,
    `groupName` VARCHAR(191) NULL,

    INDEX `challenge_feed_posts_challengeId_idx`(`challengeId`),
    INDEX `challenge_feed_posts_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `blog_articles` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `excerpt` TEXT NULL,
    `content` TEXT NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `authorId` VARCHAR(191) NOT NULL,
    `featuredImg` VARCHAR(191) NULL,
    `metaTitle` VARCHAR(191) NULL,
    `metaDesc` TEXT NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `blog_articles_slug_key`(`slug`),
    INDEX `blog_articles_slug_idx`(`slug`),
    INDEX `blog_articles_status_idx`(`status`),
    INDEX `blog_articles_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_pages` (
    `id` VARCHAR(191) NOT NULL,
    `pageKey` VARCHAR(191) NOT NULL,
    `pageUrl` VARCHAR(191) NOT NULL,
    `metaTitle` VARCHAR(191) NOT NULL,
    `metaDesc` TEXT NOT NULL,
    `canonical` VARCHAR(191) NULL,
    `ogImage` VARCHAR(191) NULL,
    `hreflang` VARCHAR(191) NOT NULL DEFAULT 'en-IN',
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `seo_pages_pageKey_key`(`pageKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_faqs` (
    `id` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL,
    `question` VARCHAR(191) NOT NULL,
    `answer` TEXT NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `seo_faqs_pageId_idx`(`pageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `website_content` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedBy` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `website_content_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `social_links` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `social_links_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_permissions` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `blogView` BOOLEAN NOT NULL DEFAULT false,
    `blogCreate` BOOLEAN NOT NULL DEFAULT false,
    `blogEdit` BOOLEAN NOT NULL DEFAULT false,
    `blogDelete` BOOLEAN NOT NULL DEFAULT false,
    `blogPublish` BOOLEAN NOT NULL DEFAULT false,
    `seoView` BOOLEAN NOT NULL DEFAULT false,
    `seoEditMeta` BOOLEAN NOT NULL DEFAULT false,
    `seoEditFaq` BOOLEAN NOT NULL DEFAULT false,
    `seoSitemap` BOOLEAN NOT NULL DEFAULT false,
    `contentView` BOOLEAN NOT NULL DEFAULT false,
    `contentHero` BOOLEAN NOT NULL DEFAULT false,
    `contentStats` BOOLEAN NOT NULL DEFAULT false,
    `contentTestimon` BOOLEAN NOT NULL DEFAULT false,
    `socialView` BOOLEAN NOT NULL DEFAULT false,
    `socialEdit` BOOLEAN NOT NULL DEFAULT false,
    `appUsersView` BOOLEAN NOT NULL DEFAULT false,
    `appUsersBan` BOOLEAN NOT NULL DEFAULT false,
    `challengesView` BOOLEAN NOT NULL DEFAULT false,
    `challengesCreate` BOOLEAN NOT NULL DEFAULT false,
    `challengesEdit` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `admin_permissions_adminId_key`(`adminId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `buddy_strikes` (
    `id` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `receiverId` VARCHAR(191) NOT NULL,
    `matchId` VARCHAR(191) NOT NULL,
    `imageUrl` TEXT NOT NULL,
    `caption` VARCHAR(191) NULL,
    `reactEmoji` VARCHAR(191) NULL,
    `viewedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `buddy_strikes_senderId_idx`(`senderId`),
    INDEX `buddy_strikes_receiverId_idx`(`receiverId`),
    INDEX `buddy_strikes_matchId_idx`(`matchId`),
    INDEX `buddy_strikes_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `influencer_applications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `instagramHandle` VARCHAR(191) NOT NULL,
    `claimedFollowers` INTEGER NOT NULL,
    `verificationCode` VARCHAR(191) NOT NULL,
    `codeExpiresAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `rejectedReason` VARCHAR(191) NULL,
    `canReapplyAt` DATETIME(3) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `influencer_applications_userId_key`(`userId`),
    INDEX `influencer_applications_status_idx`(`status`),
    INDEX `influencer_applications_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `influencer_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `influencerId` VARCHAR(191) NOT NULL,
    `fanId` VARCHAR(191) NOT NULL,
    `monthYear` VARCHAR(191) NOT NULL,
    `sessionCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `influencer_sessions_influencerId_idx`(`influencerId`),
    INDEX `influencer_sessions_fanId_idx`(`fanId`),
    UNIQUE INDEX `influencer_sessions_influencerId_fanId_monthYear_key`(`influencerId`, `fanId`, `monthYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `swipes` ADD CONSTRAINT `swipes_swiperId_fkey` FOREIGN KEY (`swiperId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `swipes` ADD CONSTRAINT `swipes_swipedId_fkey` FOREIGN KEY (`swipedId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_userAId_fkey` FOREIGN KEY (`userAId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_userBId_fkey` FOREIGN KEY (`userBId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workout_sessions` ADD CONSTRAINT `workout_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workout_sessions` ADD CONSTRAINT `workout_sessions_buddyId_fkey` FOREIGN KEY (`buddyId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workout_sessions` ADD CONSTRAINT `workout_sessions_challengeId_fkey` FOREIGN KEY (`challengeId`) REFERENCES `challenges`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `session_participants` ADD CONSTRAINT `session_participants_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `workout_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `session_participants` ADD CONSTRAINT `session_participants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chats` ADD CONSTRAINT `chats_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chats` ADD CONSTRAINT `chats_userAId_fkey` FOREIGN KEY (`userAId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chats` ADD CONSTRAINT `chats_userBId_fkey` FOREIGN KEY (`userBId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_members` ADD CONSTRAINT `chat_members_chatId_fkey` FOREIGN KEY (`chatId`) REFERENCES `chats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_members` ADD CONSTRAINT `chat_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_chatId_fkey` FOREIGN KEY (`chatId`) REFERENCES `chats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `subscription_plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `uploads` ADD CONSTRAINT `uploads_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_swipes` ADD CONSTRAINT `daily_swipes_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `xp_events` ADD CONSTRAINT `xp_events_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `challenge_stations` ADD CONSTRAINT `challenge_stations_challengeId_fkey` FOREIGN KEY (`challengeId`) REFERENCES `challenges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `challenge_entries` ADD CONSTRAINT `challenge_entries_challengeId_fkey` FOREIGN KEY (`challengeId`) REFERENCES `challenges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `challenge_entries` ADD CONSTRAINT `challenge_entries_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `challenge_entries` ADD CONSTRAINT `challenge_entries_buddyId_fkey` FOREIGN KEY (`buddyId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_completions` ADD CONSTRAINT `station_completions_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `challenge_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `station_completions` ADD CONSTRAINT `station_completions_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `challenge_stations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `challenge_feed_posts` ADD CONSTRAINT `challenge_feed_posts_challengeId_fkey` FOREIGN KEY (`challengeId`) REFERENCES `challenges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `challenge_feed_posts` ADD CONSTRAINT `challenge_feed_posts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `blog_articles` ADD CONSTRAINT `blog_articles_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seo_faqs` ADD CONSTRAINT `seo_faqs_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `seo_pages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_permissions` ADD CONSTRAINT `admin_permissions_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `buddy_strikes` ADD CONSTRAINT `buddy_strikes_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `buddy_strikes` ADD CONSTRAINT `buddy_strikes_receiverId_fkey` FOREIGN KEY (`receiverId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `buddy_strikes` ADD CONSTRAINT `buddy_strikes_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `influencer_applications` ADD CONSTRAINT `influencer_applications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `influencer_sessions` ADD CONSTRAINT `influencer_sessions_influencerId_fkey` FOREIGN KEY (`influencerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `influencer_sessions` ADD CONSTRAINT `influencer_sessions_fanId_fkey` FOREIGN KEY (`fanId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
