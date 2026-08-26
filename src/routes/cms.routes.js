const express = require('express');
const cms = require('../controllers/cms.controller');

const router = express.Router();

router.get('/seo', cms.getSeoPages);
router.get('/content', cms.getContent);
router.get('/social', cms.getSocialLinks);
router.get('/blog', cms.getArticles);
router.get('/blog/:id', cms.getArticle);

// router.get('/seo', cmsAuth('seoView'), cms.getSeoPages);
// router.get('/content', cmsAuth('contentView'), cms.getContent);
// router.get('/social', cmsAuth('socialView'), cms.getSocialLinks);
// router.get('/blog', cmsAuth('blogView'), cms.getArticles);
// router.get('/blog/:id', cmsAuth('blogView'), cms.getArticle);

module.exports = router;
