-- ─────────────────────────────────────────────────────────
--  CMS Migration — Website Admin Panel
--  Run on Railway PostgreSQL
-- ─────────────────────────────────────────────────────────

-- 1. Admin Users
CREATE TABLE IF NOT EXISTS "admin_users" (
  "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
  "name"         TEXT        NOT NULL,
  "email"        TEXT        NOT NULL,
  "passwordHash" TEXT        NOT NULL,
  "role"         TEXT        NOT NULL DEFAULT 'custom',
  "status"       TEXT        NOT NULL DEFAULT 'pending',
  "invitedBy"    UUID,
  "lastActiveAt" TIMESTAMP,
  "createdAt"    TIMESTAMP   NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT "admin_users_pkey"  PRIMARY KEY ("id"),
  CONSTRAINT "admin_users_email" UNIQUE ("email")
);

-- 2. Admin Permissions
CREATE TABLE IF NOT EXISTS "admin_permissions" (
  "id"              UUID    NOT NULL DEFAULT gen_random_uuid(),
  "adminId"         UUID    NOT NULL,
  "blogView"        BOOLEAN NOT NULL DEFAULT FALSE,
  "blogCreate"      BOOLEAN NOT NULL DEFAULT FALSE,
  "blogEdit"        BOOLEAN NOT NULL DEFAULT FALSE,
  "blogDelete"      BOOLEAN NOT NULL DEFAULT FALSE,
  "blogPublish"     BOOLEAN NOT NULL DEFAULT FALSE,
  "seoView"         BOOLEAN NOT NULL DEFAULT FALSE,
  "seoEditMeta"     BOOLEAN NOT NULL DEFAULT FALSE,
  "seoEditFaq"      BOOLEAN NOT NULL DEFAULT FALSE,
  "seoSitemap"      BOOLEAN NOT NULL DEFAULT FALSE,
  "contentView"     BOOLEAN NOT NULL DEFAULT FALSE,
  "contentHero"     BOOLEAN NOT NULL DEFAULT FALSE,
  "contentStats"    BOOLEAN NOT NULL DEFAULT FALSE,
  "contentTestimon" BOOLEAN NOT NULL DEFAULT FALSE,
  "socialView"      BOOLEAN NOT NULL DEFAULT FALSE,
  "socialEdit"      BOOLEAN NOT NULL DEFAULT FALSE,
  "appUsersView"    BOOLEAN NOT NULL DEFAULT FALSE,
  "appUsersBan"     BOOLEAN NOT NULL DEFAULT FALSE,
  "challengesView"  BOOLEAN NOT NULL DEFAULT FALSE,
  "challengesCreate" BOOLEAN NOT NULL DEFAULT FALSE,
  "challengesEdit"  BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT "admin_permissions_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "admin_permissions_adminId" UNIQUE ("adminId"),
  CONSTRAINT "admin_permissions_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE CASCADE
);

-- 3. Blog Articles
CREATE TABLE IF NOT EXISTS "blog_articles" (
  "id"          UUID      NOT NULL DEFAULT gen_random_uuid(),
  "title"       TEXT      NOT NULL,
  "slug"        TEXT      NOT NULL,
  "excerpt"     TEXT,
  "content"     TEXT      NOT NULL,
  "category"    TEXT      NOT NULL,
  "status"      TEXT      NOT NULL DEFAULT 'draft',
  "authorId"    UUID      NOT NULL,
  "featuredImg" TEXT,
  "metaTitle"   TEXT,
  "metaDesc"    TEXT,
  "publishedAt" TIMESTAMP,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "blog_articles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "blog_articles_slug" UNIQUE ("slug"),
  CONSTRAINT "blog_articles_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "admin_users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "blog_articles_slug_idx"     ON "blog_articles" ("slug");
CREATE INDEX IF NOT EXISTS "blog_articles_status_idx"   ON "blog_articles" ("status");
CREATE INDEX IF NOT EXISTS "blog_articles_category_idx" ON "blog_articles" ("category");

-- 4. SEO Pages
CREATE TABLE IF NOT EXISTS "seo_pages" (
  "id"        UUID      NOT NULL DEFAULT gen_random_uuid(),
  "pageKey"   TEXT      NOT NULL,
  "pageUrl"   TEXT      NOT NULL,
  "metaTitle" TEXT      NOT NULL,
  "metaDesc"  TEXT      NOT NULL,
  "canonical" TEXT,
  "ogImage"   TEXT,
  "hreflang"  TEXT      NOT NULL DEFAULT 'en-IN',
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "seo_pages_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "seo_pages_pageKey" UNIQUE ("pageKey")
);

-- 5. SEO FAQs
CREATE TABLE IF NOT EXISTS "seo_faqs" (
  "id"        UUID      NOT NULL DEFAULT gen_random_uuid(),
  "pageId"    UUID      NOT NULL,
  "question"  TEXT      NOT NULL,
  "answer"    TEXT      NOT NULL,
  "order"     INTEGER   NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "seo_faqs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "seo_faqs_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES "seo_pages"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "seo_faqs_pageId_idx" ON "seo_faqs" ("pageId");

-- 6. Website Content
CREATE TABLE IF NOT EXISTS "website_content" (
  "id"        UUID      NOT NULL DEFAULT gen_random_uuid(),
  "key"       TEXT      NOT NULL,
  "value"     TEXT      NOT NULL,
  "updatedBy" UUID,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "website_content_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "website_content_key"  UNIQUE ("key")
);

-- 7. Social Links
CREATE TABLE IF NOT EXISTS "social_links" (
  "id"        UUID      NOT NULL DEFAULT gen_random_uuid(),
  "key"       TEXT      NOT NULL,
  "label"     TEXT      NOT NULL,
  "url"       TEXT      NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "social_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_links_key"  UNIQUE ("key")
);

-- ── Seed default data ─────────────────────────────────────

-- Super Admin (password: changeme123 — bcrypt hashed)
INSERT INTO "admin_users" ("name","email","passwordHash","role","status")
VALUES ('Super Admin','admin@seshlly.com',
  '$2b$10$placeholder_change_this_hash','super_admin','active')
ON CONFLICT ("email") DO NOTHING;

-- Default SEO pages
INSERT INTO "seo_pages" ("pageKey","pageUrl","metaTitle","metaDesc") VALUES
('home',     'https://seshlly.com',        'Seshlly — Find Your Workout Buddy | India''s Fitness Partner App', 'Match with fitness partners near you. Schedule sessions, complete challenges, and never train alone again. Download Seshlly free.'),
('blog',     'https://seshlly.com/blog',   'Blog — Seshlly Fitness Stories & Tips', 'Real member stories, fitness industry insights, challenge updates and more from the Seshlly community.'),
('download', 'https://seshlly.com/download','Download Seshlly Free — iOS & Android', 'Download Seshlly on iOS and Android. Find workout buddies, schedule sessions and join fitness challenges. Free to download.'),
('blog_post','https://seshlly.com/blog/*', 'Blog Post — Seshlly', 'Read the latest fitness stories and tips from the Seshlly community.')
ON CONFLICT ("pageKey") DO NOTHING;

-- Default social links
INSERT INTO "social_links" ("key","label","url") VALUES
('instagram',    'Instagram',    'https://instagram.com/seshlly'),
('facebook',     'Facebook',     'https://facebook.com/seshlly'),
('app_store',    'App Store',    ''),
('play_store',   'Google Play',  ''),
('support_email','Support Email','support@seshlly.com'),
('stories_email','Stories Email','stories@seshlly.com')
ON CONFLICT ("key") DO NOTHING;

-- Default website content
INSERT INTO "website_content" ("key","value") VALUES
('hero_line1',         'Train harder.'),
('hero_line2',         'Together.'),
('hero_badge',         '🇮🇳 India''s fitness buddy app'),
('hero_sub',           'Match with workout partners near you. Schedule sessions, complete challenges, and never skip a gym day again.'),
('stat_1_value',       '50K+'),
('stat_1_label',       'Active users'),
('stat_2_value',       '2.1L+'),
('stat_2_label',       'Sessions done'),
('stat_3_value',       '98%'),
('stat_3_label',       'Match success'),
('stat_4_value',       '4.8★'),
('stat_4_label',       'App rating')
ON CONFLICT ("key") DO NOTHING;
