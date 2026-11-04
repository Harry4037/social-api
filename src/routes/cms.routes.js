const express = require('express');
const cms = require('../controllers/cms.controller');

const router = express.Router();

router.get('/seo', cms.getSeoPages);
router.get('/content', cms.getContent);
router.get('/social', cms.getSocialLinks);
// Public website: published articles only (drafts were readable by anyone)
const publishedOnly = (req, _res, next) => {
  req.query.status = 'published';
  req.query.limit = String(Math.min(Math.max(Number(req.query.limit) || 20, 1), 50));
  req.query.page = String(Math.max(Math.floor(Number(req.query.page)) || 1, 1));
  req.publicOnly = true;
  next();
};
router.get('/blog', publishedOnly, cms.getArticles);
router.get('/blog/:id', publishedOnly, cms.getArticle);

// router.get('/seo', cmsAuth('seoView'), cms.getSeoPages);
// router.get('/content', cmsAuth('contentView'), cms.getContent);
// router.get('/social', cmsAuth('socialView'), cms.getSocialLinks);
// router.get('/blog', cmsAuth('blogView'), cms.getArticles);
// router.get('/blog/:id', cmsAuth('blogView'), cms.getArticle);

module.exports = router;
