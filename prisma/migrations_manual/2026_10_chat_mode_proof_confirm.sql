-- Seshlly — Round 2 schema changes (MySQL)
-- Project uses `prisma db push`; this file is for reference / manual apply.
-- Preferred: run `npx prisma db push` (or `npm run db:push`) after pulling schema.prisma.

-- 1. Chat 24h / Normal mode
ALTER TABLE `chats`    ADD COLUMN `disappearing` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `messages` ADD COLUMN `expiresAt` DATETIME(3) NULL;
CREATE INDEX `messages_expiresAt_idx` ON `messages`(`expiresAt`);

-- 2. Buddy proof confirmation tracking
ALTER TABLE `workout_sessions`
  ADD COLUMN `proofUploadedBy`  VARCHAR(191) NULL,
  ADD COLUMN `confirmedAt`      DATETIME(3)  NULL,
  ADD COLUMN `confirmTimedOut`  BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN `confirmReminders` INT          NOT NULL DEFAULT 0;

-- 3. Discover performance (recently-active ordering)
CREATE INDEX `users_lastActiveAt_idx` ON `users`(`lastActiveAt`);

-- Existing chats default to Normal (disappearing = false), so old messages are kept.

-- ─────────────────────────────────────────────────────────
-- Round 3 — safety, reminders, leaderboard, gym map
-- (again: `npx prisma db push` does all of this automatically)
-- ─────────────────────────────────────────────────────────

-- 4. Session "starts in 1 hour" reminder
ALTER TABLE `workout_sessions` ADD COLUMN `startReminderSentAt` DATETIME(3) NULL;

-- 5. Leaderboard indexes
CREATE INDEX `users_xpTotal_idx`   ON `users`(`xpTotal`);
CREATE INDEX `users_weeklyXp_idx`  ON `users`(`weeklyXp`);
CREATE INDEX `users_monthlyXp_idx` ON `users`(`monthlyXp`);

-- 6. Block & Report
CREATE TABLE `user_blocks` (
  `id`        VARCHAR(191) NOT NULL,
  `blockerId` VARCHAR(191) NOT NULL,
  `blockedId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `user_blocks_blockerId_blockedId_key`(`blockerId`, `blockedId`),
  INDEX `user_blocks_blockedId_idx`(`blockedId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `user_blocks_blockerId_fkey` FOREIGN KEY (`blockerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `user_blocks_blockedId_fkey` FOREIGN KEY (`blockedId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_reports` (
  `id`         VARCHAR(191) NOT NULL,
  `reporterId` VARCHAR(191) NOT NULL,
  `reportedId` VARCHAR(191) NOT NULL,
  `reason`     VARCHAR(191) NOT NULL,
  `details`    TEXT NULL,
  `context`    VARCHAR(191) NULL,
  `status`     ENUM('open', 'reviewed', 'actioned', 'dismissed') NOT NULL DEFAULT 'open',
  `adminNote`  TEXT NULL,
  `reviewedBy` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `user_reports_reportedId_idx`(`reportedId`),
  INDEX `user_reports_status_idx`(`status`),
  INDEX `user_reports_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `user_reports_reporterId_fkey` FOREIGN KEY (`reporterId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `user_reports_reportedId_fkey` FOREIGN KEY (`reportedId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 7. Gym map check-ins
CREATE TABLE `gym_checkins` (
  `id`        VARCHAR(191)   NOT NULL,
  `userId`    VARCHAR(191)   NOT NULL,
  `placeId`   VARCHAR(191)   NOT NULL,
  `gymName`   VARCHAR(191)   NOT NULL,
  `address`   VARCHAR(191)   NULL,
  `latitude`  DECIMAL(10, 8) NOT NULL,
  `longitude` DECIMAL(11, 8) NOT NULL,
  `createdAt` DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3)    NOT NULL,
  INDEX `gym_checkins_userId_idx`(`userId`),
  INDEX `gym_checkins_expiresAt_idx`(`expiresAt`),
  INDEX `gym_checkins_placeId_idx`(`placeId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `gym_checkins_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 8. Forgot password — one-time email codes (only a hash is stored)
CREATE TABLE `password_resets` (
  `id`        VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `otpHash`   VARCHAR(191) NOT NULL,
  `attempts`  INTEGER      NOT NULL DEFAULT 0,
  `expiresAt` DATETIME(3)  NOT NULL,
  `usedAt`    DATETIME(3)  NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `password_resets_userId_idx`(`userId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `password_resets_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 9. Round 5 (30 Oct) — invites expire, privacy, anti-abuse
ALTER TABLE `workout_sessions`
  MODIFY `status` ENUM('scheduled','completed','missed','cancelled') NOT NULL DEFAULT 'scheduled';
ALTER TABLE `station_completions` ADD COLUMN `proofImageUrl` TEXT NULL;
ALTER TABLE `users`
  ADD COLUMN `profileVisibility` VARCHAR(191) NOT NULL DEFAULT 'public',
  ADD COLUMN `shareLocation` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `showOnline` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `matches` ADD COLUMN `streakCountedAt` DATETIME(3) NULL;
-- one referral reward per new user (check first: SELECT referredId, COUNT(*) FROM referrals
--   WHERE referredId IS NOT NULL GROUP BY referredId HAVING COUNT(*) > 1;)
CREATE UNIQUE INDEX `referrals_referredId_key` ON `referrals`(`referredId`);

-- 10. Round 6 — pen-test 2
ALTER TABLE `daily_swipes` ADD COLUMN `superLikes` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `admin_users` ADD COLUMN `passwordChangedAt` DATETIME(3) NULL;
-- Admin 2FA (TOTP) — secret is AES-GCM encrypted with ADMIN_2FA_KEY
ALTER TABLE `admin_users`
  ADD COLUMN `twoFactorSecret` TEXT NULL,
  ADD COLUMN `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false;
-- Email verification codes reuse password_resets (purpose = reset | verify_email)
ALTER TABLE `password_resets` ADD COLUMN `purpose` VARCHAR(191) NOT NULL DEFAULT 'reset';

-- 11. Product round (1 Nov) — "On my way", streak freeze
ALTER TABLE `workout_sessions` ADD COLUMN `onMyWay` JSON NULL;
ALTER TABLE `matches` ADD COLUMN `streakFreezeUsedAt` DATETIME(3) NULL;

-- 12. Load test (1 Nov, 1000 simulated users) — indexes + card lookup column
ALTER TABLE `messages` ADD COLUMN `sessionId` VARCHAR(191) NULL;
-- old invite / proof cards: copy the session id out of the JSON once
UPDATE `messages` SET `sessionId` = JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.sessionId'))
  WHERE `type` IN ('session_invite', 'proof') AND `sessionId` IS NULL;
CREATE INDEX `messages_sessionId_idx` ON `messages`(`sessionId`);
CREATE INDEX `messages_chatId_createdAt_idx` ON `messages`(`chatId`, `createdAt`);
CREATE INDEX `messages_chatId_isRead_idx` ON `messages`(`chatId`, `isRead`);
CREATE INDEX `notifications_userId_createdAt_idx` ON `notifications`(`userId`, `createdAt`);
CREATE INDEX `notifications_userId_isRead_idx` ON `notifications`(`userId`, `isRead`);
CREATE INDEX `workout_sessions_proofUploadedBy_idx` ON `workout_sessions`(`proofUploadedBy`);

-- 13. Architecture round (1 Nov) — idempotency, one-server crons, payment webhook, indexes
CREATE TABLE `idempotency_keys` (
  `id` VARCHAR(191) NOT NULL,
  `scope` VARCHAR(191) NOT NULL,
  `key` VARCHAR(100) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `method` VARCHAR(10) NOT NULL,
  `path` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'in_progress',
  `responseCode` INTEGER NULL,
  `responseBody` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idempotency_keys_expiresAt_idx` (`expiresAt`),
  UNIQUE INDEX `idempotency_keys_scope_key_key` (`scope`,`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `job_runs` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `slot` VARCHAR(16) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `job_runs_createdAt_idx` (`createdAt`),
  UNIQUE INDEX `job_runs_name_slot_key` (`name`,`slot`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `webhook_events` (
  `id` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(20) NOT NULL,
  `eventId` VARCHAR(100) NOT NULL,
  `type` VARCHAR(60) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `webhook_events_provider_eventId_key` (`provider`,`eventId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE INDEX `xp_events_createdAt_userId_xpAmount_idx` ON `xp_events`(`createdAt`, `userId`, `xpAmount`);
CREATE INDEX `workout_sessions_status_endTime_idx` ON `workout_sessions`(`status`, `endTime`);
CREATE INDEX `workout_sessions_status_scheduledAt_idx` ON `workout_sessions`(`status`, `scheduledAt`);
CREATE INDEX `workout_sessions_userId_scheduledAt_idx` ON `workout_sessions`(`userId`, `scheduledAt`);
CREATE INDEX `workout_sessions_buddyId_scheduledAt_idx` ON `workout_sessions`(`buddyId`, `scheduledAt`);
CREATE INDEX `swipes_swipedId_createdAt_idx` ON `swipes`(`swipedId`, `createdAt`);
CREATE INDEX `notifications_isRead_createdAt_idx` ON `notifications`(`isRead`, `createdAt`);

-- 14. One level table (1 Nov): re-compute every user's level from XP
--     (same thresholds as src/utils/xp.js and the app). No schema change.
UPDATE `users` SET `level` = CASE
  WHEN `xpTotal` >= 5500 THEN 10 WHEN `xpTotal` >= 4000 THEN 9 WHEN `xpTotal` >= 3000 THEN 8
  WHEN `xpTotal` >= 2200 THEN 7  WHEN `xpTotal` >= 1500 THEN 6 WHEN `xpTotal` >= 1000 THEN 5
  WHEN `xpTotal` >= 600  THEN 4  WHEN `xpTotal` >= 300  THEN 3 WHEN `xpTotal` >= 100  THEN 2
  ELSE 1 END;
