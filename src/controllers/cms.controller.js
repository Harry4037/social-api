
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const res_ = require('../utils/response');

const getSeoPages = async (req, res, next) => {
  try {
    const pages = await prisma.seoPage.findMany({
      include: { faqs: { orderBy: { order: 'asc' } } },
    });
    return res_.success(res, { pages });
  } catch (e) { next(e); }
};


const getContent = async (req, res, next) => {
  try {
    const items = await prisma.websiteContent.findMany();
    const content = {};
    items.forEach(i => { content[i.key] = i.value; });
    return res_.success(res, { content });
  } catch (e) { next(e); }
};

const getSocialLinks = async (req, res, next) => {
  try {
    const links = await prisma.socialLink.findMany();
    return res_.success(res, { links });
  } catch (e) { next(e); }
};

const getArticles = async (req, res, next) => {
  try {
    const { category, status, page = 1, limit = 20 } = req.query;

    const articles = await prisma.blogArticle.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
      },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });

    const total = await prisma.blogArticle.count({
      where: {
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
      },
    });

    res.json({
      articles: articles.map(_formatArticle),
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });

  } catch (e) { next(e); }
};

const getArticle = async (req, res, next) => {
  try {
    const article = await prisma.blogArticle.findUnique({
      where: { id: req.params.id },
      include: { author: { select: { id: true, name: true } } },
    });
    if (!article) return res_.error(res, 'Article not found', 404);
    return res_.success(res, _formatArticle(article));
  } catch (e) { next(e); }
};


module.exports = {
  getArticles, getArticle,
  getSeoPages,
  getContent,
  getSocialLinks,
};
