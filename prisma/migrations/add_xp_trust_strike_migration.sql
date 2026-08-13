-- ─────────────────────────────────────────────────────────
--  Seshlly Migration: XP + Trust + Strike 2 System
--  Run on Railway PostgreSQL
--  Safe: all ADD COLUMN with defaults, no drops
-- ─────────────────────────────────────────────────────────

-- 1. User table — add weeklyXp, monthlyXp, fix trustScore default
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "weeklyXp"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "monthlyXp" INTEGER NOT NULL DEFAULT 0;

-- Fix trustScore default (existing rows keep their value, new users get 30)
ALTER TABLE "users"
  ALTER COLUMN "trustScore" SET DEFAULT 30.00;

-- 2. Match table — add Strike 2 fields
ALTER TABLE "matches"
  ADD COLUMN IF NOT EXISTS "buddyStrikeStreak" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "strikeCount"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastStrikeAt"      TIMESTAMP;

-- 3. BuddyStrike table (new)
CREATE TABLE IF NOT EXISTS "buddy_strikes" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "senderId"    UUID        NOT NULL,
  "receiverId"  UUID        NOT NULL,
  "matchId"     UUID        NOT NULL,
  "imageUrl"    TEXT        NOT NULL,
  "caption"     TEXT,
  "reactEmoji"  TEXT,
  "viewedAt"    TIMESTAMP,
  "expiresAt"   TIMESTAMP   NOT NULL,
  "createdAt"   TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT "buddy_strikes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "buddy_strikes_senderId_fkey"
    FOREIGN KEY ("senderId")   REFERENCES "users"("id")   ON DELETE CASCADE,
  CONSTRAINT "buddy_strikes_receiverId_fkey"
    FOREIGN KEY ("receiverId") REFERENCES "users"("id")   ON DELETE CASCADE,
  CONSTRAINT "buddy_strikes_matchId_fkey"
    FOREIGN KEY ("matchId")    REFERENCES "matches"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "buddy_strikes_senderId_idx"   ON "buddy_strikes" ("senderId");
CREATE INDEX IF NOT EXISTS "buddy_strikes_receiverId_idx" ON "buddy_strikes" ("receiverId");
CREATE INDEX IF NOT EXISTS "buddy_strikes_matchId_idx"    ON "buddy_strikes" ("matchId");
CREATE INDEX IF NOT EXISTS "buddy_strikes_expiresAt_idx"  ON "buddy_strikes" ("expiresAt");

-- 4. Update existing users: set trustScore to 30 only if still at old default 50
-- (Don't reset users who have already earned trust)
UPDATE "users"
  SET "trustScore" = 30.00
  WHERE "trustScore" = 50.00
  AND "createdAt" > NOW() - INTERVAL '1 day';
-- Note: Only resets users created in last 24hrs who haven't earned trust yet.
-- Existing active users keep their score.

-- Done
SELECT 'Migration complete: XP + Trust + Strike 2' AS status;
