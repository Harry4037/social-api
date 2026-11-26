-- Buddy Map (Nov 2026): Ghost Mode.
-- Run once on the live database (or `npx prisma db push`, which does the same).
-- Safe to run on a database that already has it: it only adds the column if missing.
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'mapGhostUntil');
SET @sql := IF(@has = 0, 'ALTER TABLE `users` ADD COLUMN `mapGhostUntil` DATETIME(3) NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
