-- Seshlly V2 — Challenge System Migration
-- Run against your Railway PostgreSQL database

CREATE TABLE IF NOT EXISTS "Challenge" (
  "id"                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "title"               TEXT        NOT NULL,
  "description"         TEXT        NOT NULL,
  "type"                TEXT        NOT NULL,
  "tier"                INTEGER     NOT NULL DEFAULT 1,
  "cityId"              TEXT,
  "startAt"             TIMESTAMPTZ NOT NULL,
  "endAt"               TIMESTAMPTZ NOT NULL,
  "xpPool"              INTEGER     NOT NULL DEFAULT 0,
  "entryLevelRequired"  INTEGER     NOT NULL DEFAULT 1,
  "trustRequired"       INTEGER     NOT NULL DEFAULT 0,
  "maxParticipants"     INTEGER,
  "isActive"            BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "ChallengeStation" (
  "id"            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  "challengeId"   UUID    NOT NULL REFERENCES "Challenge"("id") ON DELETE CASCADE,
  "stationNum"    INTEGER NOT NULL,
  "title"         TEXT    NOT NULL,
  "description"   TEXT    NOT NULL,
  "verifyType"    TEXT    NOT NULL DEFAULT 'count',
  "targetValue"   INTEGER NOT NULL DEFAULT 1,
  "buddyRequired" BOOLEAN NOT NULL DEFAULT false,
  "xpReward"      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "ChallengeEntry" (
  "id"             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "challengeId"    UUID        NOT NULL REFERENCES "Challenge"("id"),
  "userId"         UUID        NOT NULL REFERENCES "User"("id"),
  "buddyId"        UUID        REFERENCES "User"("id"),
  "status"         TEXT        NOT NULL DEFAULT 'active',
  "currentStation" INTEGER     NOT NULL DEFAULT 1,
  "totalXpEarned"  INTEGER     NOT NULL DEFAULT 0,
  "rankCity"       INTEGER,
  "rankGlobal"     INTEGER,
  "joinedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastSessionAt"  TIMESTAMPTZ,
  "completedAt"    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "StationCompletion" (
  "id"            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "entryId"       UUID        NOT NULL REFERENCES "ChallengeEntry"("id") ON DELETE CASCADE,
  "stationId"     UUID        NOT NULL REFERENCES "ChallengeStation"("id"),
  "stationNum"    INTEGER     NOT NULL,
  "completedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "xpAwarded"     INTEGER     NOT NULL DEFAULT 0,
  "progressValue" INTEGER     NOT NULL DEFAULT 0,
  "isCollab"      BOOLEAN     NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS "ChallengeFeedPost" (
  "id"              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "challengeId"     UUID        NOT NULL REFERENCES "Challenge"("id"),
  "userId"          UUID        NOT NULL REFERENCES "User"("id"),
  "stationNum"      INTEGER     NOT NULL,
  "stationTitle"    TEXT        NOT NULL,
  "postedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "xpAwarded"       INTEGER     NOT NULL DEFAULT 0,
  "proofImageUrl"   TEXT,
  "isCollab"        BOOLEAN     NOT NULL DEFAULT false,
  "collabUserId"    UUID,
  "collabUserName"  TEXT,
  "collabAvatarUrl" TEXT,
  "activitySlug"    TEXT
);

CREATE INDEX IF NOT EXISTS idx_challenge_active  ON "Challenge"("isActive");
CREATE INDEX IF NOT EXISTS idx_challenge_tier    ON "Challenge"("tier");
CREATE INDEX IF NOT EXISTS idx_entry_user        ON "ChallengeEntry"("userId");
CREATE INDEX IF NOT EXISTS idx_entry_challenge   ON "ChallengeEntry"("challengeId");
CREATE INDEX IF NOT EXISTS idx_feed_challenge    ON "ChallengeFeedPost"("challengeId", "postedAt" DESC);
