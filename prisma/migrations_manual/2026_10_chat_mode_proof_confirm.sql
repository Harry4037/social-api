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
