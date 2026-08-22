// ─────────────────────────────────────────────────────────
//  cms.controller.js
//  All website CMS endpoints
//  Auth: JWT + role check middleware
// ─────────────────────────────────────────────────────────
const { PrismaClient } = require('@prisma/client');
const bcrypt           = require('bcryptjs');
const jwt              = require('jsonwebtoken');
const { v4: uuid }     = require('uuid');
const prisma           = new PrismaClient();
const res_   = require('../../utils/response');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

// ── ROLE PERMISSION PRESETS ────────────────────────────────
const ROLE_PRESETS = {
  blog_editor: {
    blogView: true, blogCreate: true, blogEdit: true,
    blogDelete: false, blogPublish: false,
    seoView: false, seoEditMeta: false, seoEditFaq: false, seoSitemap: false,
    contentView: false, contentHero: false, contentStats: false, contentTestimon: false,
    socialView: false, socialEdit: false,
    appUsersView: false, appUsersBan: false,
    challengesView: false, challengesCreate: false, challengesEdit: false,
  },
  seo_manager: {
    blogView: true, blogCreate: false, blogEdit: false,
    blogDelete: false, blogPublish: false,
    seoView: true, seoEditMeta: true, seoEditFaq: true, seoSitemap: true,
    contentView: true, contentHero: true, contentStats: true, contentTestimon: true,
    socialView: true, socialEdit: false,
    appUsersView: false, appUsersBan: false,
    challengesView: false, challengesCreate: false, challengesEdit: false,
  },
  website_manager: {
    blogView: true, blogCreate: true, blogEdit: true,
    blogDelete: true, blogPublish: true,
    seoView: true, seoEditMeta: true, seoEditFaq: true, seoSitemap: true,
    contentView: true, contentHero: true, contentStats: true, contentTestimon: true,
    socialView: true, socialEdit: true,
    appUsersView: false, appUsersBan: false,
    challengesView: true, challengesCreate: false, challengesEdit: false,
  },
};

// ── MIDDLEWARE: Auth + Permission check ────────────────────
const cmsAuth = (permKey = null) => async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res_.error(res, 'Unauthorized', 401);

    const decoded = jwt.verify(token, JWT_SECRET);
    const admin   = await prisma.adminUser.findUnique({
      where:   { id: decoded.id },
      include: { permissions: true },
    });

    if (!admin || admin.status !== 'active')
      return res_.error(res, 'Access denied', 403);

    // Super admin bypasses all permission checks
    if (admin.role === 'super_admin') {
      req.admin = admin;
      return next();
    }

    // Check specific permission
    if (permKey && !admin.permissions?.[permKey])
      return res_.error(res, `You don't have permission: ${permKey}`, 403);

    req.admin = admin;
    next();
  } catch (e) {
    return res_.error(res, 'Invalid or expired token', 401);
  }
};

// ═══════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════

// POST /cms/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res_.error(res, 'Email and password required', 422);

    const admin = await prisma.adminUser.findUnique({
      where:   { email: email.toLowerCase() },
      include: { permissions: true },
    });

    if (!admin) return res_.error(res, 'Invalid credentials', 401);
    if (admin.status === 'revoked')
      return res_.error(res, 'Your access has been revoked', 403);
    if (admin.status === 'pending')
      return res_.error(res, 'Account not yet activated. Check your email.', 403);

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) return res_.error(res, 'Invalid credentials', 401);

    // Update lastActiveAt
    await prisma.adminUser.update({
      where: { id: admin.id },
      data:  { lastActiveAt: new Date() },
    });

    const token = jwt.sign(
      { id: admin.id, role: admin.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res_.success(res, {
      token,
      admin: _formatAdmin(admin),
    }, 'Login successful');
  } catch (e) { next(e); }
};

// GET /cms/auth/me
const getMe = async (req, res, next) => {
  try {
    const admin = await prisma.adminUser.findUnique({
      where:   { id: req.admin.id },
      include: { permissions: true },
    });
    return res_.success(res, _formatAdmin(admin));
  } catch (e) { next(e); }
};

// ═══════════════════════════════════════════════════════════
//  TEAM ACCESS (Super Admin only)
// ═══════════════════════════════════════════════════════════

// GET /cms/team
const getTeam = async (req, res, next) => {
  try {
    const members = await prisma.adminUser.findMany({
      where:   { role: { not: 'super_admin' } },
      include: { permissions: true },
      orderBy: { createdAt: 'desc' },
    });
    return res_.success(res, { members: members.map(_formatAdmin) });
  } catch (e) { next(e); }
};

// POST /cms/team/invite
const inviteMember = async (req, res, next) => {
  try {
    const { name, email, role = 'custom', permissions: perms } = req.body;

    if (!name || !email)
      return res_.error(res, 'Name and email required', 422);
    if (role === 'super_admin')
      return res_.error(res, 'Cannot assign super_admin role', 403);

    const existing = await prisma.adminUser.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existing) return res_.error(res, 'Email already exists', 409);

    // Temp password — user sets own via invite link
    const tempPass = Math.random().toString(36).slice(-10);
    const hash     = await bcrypt.hash(tempPass, 10);

    // Build permissions from preset or custom
    const permData = role !== 'custom' && ROLE_PRESETS[role]
      ? ROLE_PRESETS[role]
      : { ...ROLE_PRESETS.blog_editor, ...perms }; // default all false, override with provided

    const admin = await prisma.adminUser.create({
      data: {
        id:           uuid(),
        name,
        email:        email.toLowerCase(),
        passwordHash: hash,
        role,
        status:       'pending',
        invitedBy:    req.admin.id,
        permissions: { create: { id: uuid(), ...permData } },
      },
      include: { permissions: true },
    });

    // TODO: send invite email with tempPass or magic link
    // await emailSvc.sendInvite(email, name, tempPass);

    return res_.created(res, _formatAdmin(admin),
      `Invite sent to ${email}`);
  } catch (e) { next(e); }
};

// PUT /cms/team/:id
const updateMember = async (req, res, next) => {
  try {
    const { role, status, permissions: perms } = req.body;
    const { id } = req.params;

    const target = await prisma.adminUser.findUnique({ where: { id } });
    if (!target) return res_.error(res, 'Member not found', 404);
    if (target.role === 'super_admin')
      return res_.error(res, 'Cannot modify super admin', 403);
    if (role === 'super_admin')
      return res_.error(res, 'Cannot assign super_admin role', 403);

    // Update admin user
    const updateData = {};
    if (role)   updateData.role   = role;
    if (status) updateData.status = status;

    await prisma.adminUser.update({ where: { id }, data: updateData });

    // Update permissions if provided
    if (perms) {
      // If role preset selected
      const permData = role && role !== 'custom' && ROLE_PRESETS[role]
        ? ROLE_PRESETS[role]
        : perms;

      await prisma.adminPermission.upsert({
        where:  { adminId: id },
        update: permData,
        create: { id: uuid(), adminId: id, ...permData },
      });
    }

    const updated = await prisma.adminUser.findUnique({
      where:   { id },
      include: { permissions: true },
    });
    return res_.success(res, _formatAdmin(updated), 'Member updated');
  } catch (e) { next(e); }
};

// DELETE /cms/team/:id — revoke access
const revokeMember = async (req, res, next) => {
  try {
    const target = await prisma.adminUser.findUnique({
      where: { id: req.params.id },
    });
    if (!target) return res_.error(res, 'Member not found', 404);
    if (target.role === 'super_admin')
      return res_.error(res, 'Cannot revoke super admin', 403);

    await prisma.adminUser.update({
      where: { id: req.params.id },
      data:  { status: 'revoked' },
    });
    return res_.success(res, {}, 'Access revoked');
  } catch (e) { next(e); }
};

// ═══════════════════════════════════════════════════════════
//  BLOG
// ═══════════════════════════════════════════════════════════

// GET /cms/blog
const getArticles = async (req, res, next) => {
  try {
    const { category, status, page = 1 } = req.query;
    const take = 20;
    const skip = (Number(page) - 1) * take;

    const articles = await prisma.blogArticle.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(status   ? { status }   : {}),
      },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take, skip,
    });

    const total = await prisma.blogArticle.count({
      where: {
        ...(category ? { category } : {}),
        ...(status   ? { status }   : {}),
      },
    });

    return res_.success(res, {
      articles: articles.map(_formatArticle),
      total, page: Number(page),
    });
  } catch (e) { next(e); }
};

// GET /cms/blog/:id
const getArticle = async (req, res, next) => {
  try {
    const article = await prisma.blogArticle.findUnique({
      where:   { id: req.params.id },
      include: { author: { select: { id: true, name: true } } },
    });
    if (!article) return res_.error(res, 'Article not found', 404);
    return res_.success(res, _formatArticle(article));
  } catch (e) { next(e); }
};

// POST /cms/blog
const createArticle = async (req, res, next) => {
  try {
    const {
      title, content, category, status = 'draft',
      excerpt, featuredImg, metaTitle, metaDesc, slug,
    } = req.body;

    if (!title || !content || !category)
      return res_.error(res, 'title, content, category required', 422);

    // Auto-generate slug if not provided
    const finalSlug = slug ||
      title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Check slug unique
    const exists = await prisma.blogArticle.findUnique({
      where: { slug: finalSlug },
    });
    if (exists) return res_.error(res, 'Slug already exists', 409);

    const article = await prisma.blogArticle.create({
      data: {
        id:          uuid(),
        title,
        slug:        finalSlug,
        content,
        category,
        status,
        excerpt:     excerpt || null,
        featuredImg: featuredImg || null,
        metaTitle:   metaTitle || null,
        metaDesc:    metaDesc || null,
        authorId:    req.admin.id,
        publishedAt: status === 'published' ? new Date() : null,
      },
      include: { author: { select: { id: true, name: true } } },
    });

    return res_.created(res, _formatArticle(article), 'Article created');
  } catch (e) { next(e); }
};

// PUT /cms/blog/:id
const updateArticle = async (req, res, next) => {
  try {
    const article = await prisma.blogArticle.findUnique({
      where: { id: req.params.id },
    });
    if (!article) return res_.error(res, 'Article not found', 404);

    const {
      title, content, category, status,
      excerpt, featuredImg, metaTitle, metaDesc,
    } = req.body;

    const updated = await prisma.blogArticle.update({
      where: { id: req.params.id },
      data: {
        ...(title       ? { title }       : {}),
        ...(content     ? { content }     : {}),
        ...(category    ? { category }    : {}),
        ...(excerpt     ? { excerpt }     : {}),
        ...(featuredImg ? { featuredImg } : {}),
        ...(metaTitle   ? { metaTitle }   : {}),
        ...(metaDesc    ? { metaDesc }    : {}),
        ...(status ? {
          status,
          publishedAt: status === 'published' && !article.publishedAt
            ? new Date() : article.publishedAt,
        } : {}),
      },
      include: { author: { select: { id: true, name: true } } },
    });

    return res_.success(res, _formatArticle(updated), 'Article updated');
  } catch (e) { next(e); }
};

// DELETE /cms/blog/:id
const deleteArticle = async (req, res, next) => {
  try {
    await prisma.blogArticle.delete({ where: { id: req.params.id } });
    return res_.success(res, {}, 'Article deleted');
  } catch (e) { next(e); }
};

// ═══════════════════════════════════════════════════════════
//  SEO
// ═══════════════════════════════════════════════════════════

// GET /cms/seo
const getSeoPages = async (req, res, next) => {
  try {
    const pages = await prisma.seoPage.findMany({
      include: { faqs: { orderBy: { order: 'asc' } } },
    });
    return res_.success(res, { pages });
  } catch (e) { next(e); }
};

// PUT /cms/seo/:pageKey
const updateSeoPage = async (req, res, next) => {
  try {
    const { metaTitle, metaDesc, canonical, ogImage, hreflang } = req.body;
    const page = await prisma.seoPage.upsert({
      where:  { pageKey: req.params.pageKey },
      update: {
        ...(metaTitle ? { metaTitle } : {}),
        ...(metaDesc  ? { metaDesc }  : {}),
        ...(canonical ? { canonical } : {}),
        ...(ogImage   ? { ogImage }   : {}),
        ...(hreflang  ? { hreflang }  : {}),
      },
      create: {
        id:       uuid(),
        pageKey:  req.params.pageKey,
        pageUrl:  `https://seshlly.com/${req.params.pageKey === 'home' ? '' : req.params.pageKey}`,
        metaTitle: metaTitle || '',
        metaDesc:  metaDesc  || '',
        canonical: canonical || null,
        ogImage:   ogImage   || null,
        hreflang:  hreflang  || 'en-IN',
      },
      include: { faqs: true },
    });
    return res_.success(res, page, 'SEO updated');
  } catch (e) { next(e); }
};

// POST /cms/seo/:pageKey/faq
const addFaq = async (req, res, next) => {
  try {
    const { question, answer } = req.body;
    if (!question || !answer)
      return res_.error(res, 'question and answer required', 422);

    const page = await prisma.seoPage.findUnique({
      where: { pageKey: req.params.pageKey },
    });
    if (!page) return res_.error(res, 'SEO page not found', 404);

    const count = await prisma.seoFaq.count({ where: { pageId: page.id } });
    const faq = await prisma.seoFaq.create({
      data: { id: uuid(), pageId: page.id, question, answer, order: count },
    });
    return res_.created(res, faq, 'FAQ added');
  } catch (e) { next(e); }
};

// PUT /cms/seo/faq/:faqId
const updateFaq = async (req, res, next) => {
  try {
    const { question, answer } = req.body;
    const faq = await prisma.seoFaq.update({
      where: { id: req.params.faqId },
      data:  {
        ...(question ? { question } : {}),
        ...(answer   ? { answer }   : {}),
      },
    });
    return res_.success(res, faq, 'FAQ updated');
  } catch (e) { next(e); }
};

// DELETE /cms/seo/faq/:faqId
const deleteFaq = async (req, res, next) => {
  try {
    await prisma.seoFaq.delete({ where: { id: req.params.faqId } });
    return res_.success(res, {}, 'FAQ deleted');
  } catch (e) { next(e); }
};

// ═══════════════════════════════════════════════════════════
//  WEBSITE CONTENT
// ═══════════════════════════════════════════════════════════

// GET /cms/content
const getContent = async (req, res, next) => {
  try {
    const items = await prisma.websiteContent.findMany();
    const content = {};
    items.forEach(i => { content[i.key] = i.value; });
    return res_.success(res, { content });
  } catch (e) { next(e); }
};

// PUT /cms/content — bulk update
const updateContent = async (req, res, next) => {
  try {
    const { updates } = req.body; // { key: value, ... }
    if (!updates || typeof updates !== 'object')
      return res_.error(res, 'updates object required', 422);

    const ops = Object.entries(updates).map(([key, value]) =>
      prisma.websiteContent.upsert({
        where:  { key },
        update: { value: String(value), updatedBy: req.admin.id },
        create: { id: uuid(), key, value: String(value), updatedBy: req.admin.id },
      })
    );
    await Promise.all(ops);
    return res_.success(res, {}, 'Content updated');
  } catch (e) { next(e); }
};

// ═══════════════════════════════════════════════════════════
//  SOCIAL LINKS
// ═══════════════════════════════════════════════════════════

// GET /cms/social
const getSocialLinks = async (req, res, next) => {
  try {
    const links = await prisma.socialLink.findMany();
    return res_.success(res, { links });
  } catch (e) { next(e); }
};

// PUT /cms/social — bulk update
const updateSocialLinks = async (req, res, next) => {
  try {
    const { links } = req.body; // [{ key, url }]
    if (!Array.isArray(links))
      return res_.error(res, 'links array required', 422);

    const ops = links.map(({ key, url }) =>
      prisma.socialLink.update({ where: { key }, data: { url } })
    );
    await Promise.all(ops);
    return res_.success(res, {}, 'Social links updated');
  } catch (e) { next(e); }
};

// ═══════════════════════════════════════════════════════════
//  DASHBOARD STATS
// ═══════════════════════════════════════════════════════════

// GET /cms/dashboard
const getDashboard = async (req, res, next) => {
  try {
    const [totalArticles, publishedArticles, teamCount] = await Promise.all([
      prisma.blogArticle.count(),
      prisma.blogArticle.count({ where: { status: 'published' } }),
      prisma.adminUser.count({ where: { role: { not: 'super_admin' } } }),
    ]);

    const recentArticles = await prisma.blogArticle.findMany({
      take:    5,
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, name: true } } },
    });

    const recentTeam = await prisma.adminUser.findMany({
      where:   { role: { not: 'super_admin' } },
      take:    5,
      orderBy: { createdAt: 'desc' },
      include: { permissions: true },
    });

    return res_.success(res, {
      stats: {
        totalArticles,
        publishedArticles,
        draftArticles: totalArticles - publishedArticles,
        teamCount,
      },
      recentArticles: recentArticles.map(_formatArticle),
      recentTeam:     recentTeam.map(_formatAdmin),
    });
  } catch (e) { next(e); }
};

// ── Formatters ─────────────────────────────────────────────
const _formatAdmin = (a) => ({
  id:           a.id,
  name:         a.name,
  email:        a.email,
  role:         a.role,
  status:       a.status,
  lastActiveAt: a.lastActiveAt,
  createdAt:    a.createdAt,
  permissions:  a.permissions || null,
  // Never return passwordHash
});

const _formatArticle = (a) => ({
  id:          a.id,
  title:       a.title,
  slug:        a.slug,
  excerpt:     a.excerpt,
  content:     a.content,
  category:    a.category,
  status:      a.status,
  featuredImg: a.featuredImg,
  metaTitle:   a.metaTitle,
  metaDesc:    a.metaDesc,
  publishedAt: a.publishedAt,
  createdAt:   a.createdAt,
  author:      a.author,
});

module.exports = {
  cmsAuth,
  login, getMe,
  getTeam, inviteMember, updateMember, revokeMember,
  getArticles, getArticle, createArticle, updateArticle, deleteArticle,
  getSeoPages, updateSeoPage, addFaq, updateFaq, deleteFaq,
  getContent, updateContent,
  getSocialLinks, updateSocialLinks,
  getDashboard,
};
