// ─────────────────────────────────────────────────────────
//  cms.routes.js
//  Mount in server.js: app.use('/api/cms', cmsRouter)
// ─────────────────────────────────────────────────────────
const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/middleware');
const cms = require('../controllers/cms.controller');
const { cmsAuth } = cms;

const router = express.Router();

// ── AUTH ──────────────────────────────────────────────────
router.post('/auth/login', [
  body('email').isEmail(),
  body('password').notEmpty(),
], validate, cms.login);

router.get('/auth/me', cmsAuth(), cms.getMe);

// ── DASHBOARD ─────────────────────────────────────────────
router.get('/dashboard', cmsAuth(), cms.getDashboard);

// ── TEAM ACCESS (super_admin only) ────────────────────────
router.get   ('/team',     cmsAuth(), cms.getTeam);
router.post  ('/team/invite', cmsAuth(), [
  body('name').trim().notEmpty(),
  body('email').isEmail(),
  body('role').optional().isIn(['blog_editor','seo_manager','website_manager','custom']),
], validate, cms.inviteMember);
router.put   ('/team/:id', cmsAuth(), [
  param('id').isUUID(),
  body('role').optional().isIn(['blog_editor','seo_manager','website_manager','custom']),
  body('status').optional().isIn(['active','pending','revoked']),
], validate, cms.updateMember);
router.delete('/team/:id', cmsAuth(), [
  param('id').isUUID(),
], validate, cms.revokeMember);

// ── BLOG ──────────────────────────────────────────────────
router.get   ('/blog',     cmsAuth('blogView'),   cms.getArticles);
router.get   ('/blog/:id', cmsAuth('blogView'),   cms.getArticle);
router.post  ('/blog',     cmsAuth('blogCreate'), [
  body('title').trim().notEmpty(),
  body('content').notEmpty(),
  body('category').isIn(['member_story','challenge','fitness_industry','app_update','upcoming']),
  body('status').optional().isIn(['draft','published']),
], validate, cms.createArticle);
router.put   ('/blog/:id', cmsAuth('blogEdit'), [
  param('id').isUUID(),
], validate, cms.updateArticle);
router.delete('/blog/:id', cmsAuth('blogDelete'), [
  param('id').isUUID(),
], validate, cms.deleteArticle);

// ── SEO ───────────────────────────────────────────────────
router.get('/seo',                    cmsAuth('seoView'),    cms.getSeoPages);
router.put('/seo/:pageKey',           cmsAuth('seoEditMeta'),cms.updateSeoPage);
router.post('/seo/:pageKey/faq',      cmsAuth('seoEditFaq'), [
  body('question').notEmpty(),
  body('answer').notEmpty(),
], validate, cms.addFaq);
router.put   ('/seo/faq/:faqId',      cmsAuth('seoEditFaq'), cms.updateFaq);
router.delete('/seo/faq/:faqId',      cmsAuth('seoEditFaq'), cms.deleteFaq);

// ── WEBSITE CONTENT ───────────────────────────────────────
router.get('/content',   cmsAuth('contentView'), cms.getContent);
router.put('/content',   cmsAuth('contentHero'), [
  body('updates').isObject(),
], validate, cms.updateContent);

// ── SOCIAL LINKS ──────────────────────────────────────────
router.get('/social',    cmsAuth('socialView'), cms.getSocialLinks);
router.put('/social',    cmsAuth('socialEdit'), [
  body('links').isArray(),
], validate, cms.updateSocialLinks);

module.exports = router;
