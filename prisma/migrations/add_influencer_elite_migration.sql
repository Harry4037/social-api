-- ─────────────────────────────────────────────────────────
--  Influencer + Elite System Migration
--  Run on Railway PostgreSQL
--  Safe: ADD COLUMN with defaults, no drops
-- ─────────────────────────────────────────────────────────

-- 1. User table — influencer new fields
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "influencerBio"          TEXT,
  ADD COLUMN IF NOT EXISTS "influencerAppliedAt"    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "instagramVerifiedAt"    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "influencerSessionLimit" INTEGER NOT NULL DEFAULT 3;

-- Index for influencer discover queries
CREATE INDEX IF NOT EXISTS "users_isInfluencer_idx" ON "users" ("isInfluencer");

-- 2. InfluencerApplication table
CREATE TABLE IF NOT EXISTS "influencer_applications" (
  "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
  "userId"           UUID        NOT NULL,
  "instagramHandle"  TEXT        NOT NULL,
  "claimedFollowers" INTEGER     NOT NULL,
  "verificationCode" TEXT        NOT NULL,
  "codeExpiresAt"    TIMESTAMP   NOT NULL,
  "status"           TEXT        NOT NULL DEFAULT 'pending',
  "rejectedReason"   TEXT,
  "canReapplyAt"     TIMESTAMP,
  "reviewedBy"       UUID,
  "reviewedAt"       TIMESTAMP,
  "createdAt"        TIMESTAMP   NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT "influencer_applications_pkey"   PRIMARY KEY ("id"),
  CONSTRAINT "influencer_applications_userId" UNIQUE ("userId"),
  CONSTRAINT "influencer_applications_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "influencer_applications_status_idx" ON "influencer_applications" ("status");
CREATE INDEX IF NOT EXISTS "influencer_applications_userId_idx" ON "influencer_applications" ("userId");

-- 3. InfluencerSession table (monthly limit tracking)
CREATE TABLE IF NOT EXISTS "influencer_sessions" (
  "id"           UUID      NOT NULL DEFAULT gen_random_uuid(),
  "influencerId" UUID      NOT NULL,
  "fanId"        UUID      NOT NULL,
  "monthYear"    TEXT      NOT NULL,
  "sessionCount" INTEGER   NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "influencer_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "influencer_sessions_unique" UNIQUE ("influencerId", "fanId", "monthYear"),
  CONSTRAINT "influencer_sessions_influencerId_fkey"
    FOREIGN KEY ("influencerId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "influencer_sessions_fanId_fkey"
    FOREIGN KEY ("fanId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "influencer_sessions_influencerId_idx" ON "influencer_sessions" ("influencerId");
CREATE INDEX IF NOT EXISTS "influencer_sessions_fanId_idx"        ON "influencer_sessions" ("fanId");

-- 4. SubscriptionPlanConfig — update Elite plan price
-- (Only update if config table exists and elite row exists)
UPDATE "subscription_plan_configs"
  SET "price" = 599, "updatedAt" = NOW()
  WHERE "planId" = 'elite'
  AND EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_name = 'subscription_plan_configs');

SELECT 'Migration complete: Influencer + Elite system' AS status;
