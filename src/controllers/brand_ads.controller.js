'use strict';
// ─────────────────────────────────────────────────────────
//  brand_ads.controller.js
//  Brand Ads — Feed sponsored posts
// ─────────────────────────────────────────────────────────
const { v4: uuid } = require('uuid');
const prisma        = require('../config/db');
const res_          = require('../utils/response');

// ── GET /api/feed/ads — active ad for user (Flutter) ─────
const getActiveAd = async (req, res, next) => {
  try {
    const now  = new Date();
    const city = req.user?.city;

    const ad = await prisma.brandAd.findFirst({
      where: {
        isActive:  true,
        startDate: { lte: now },
        endDate:   { gte: now },
        OR: [
          { cityTarget: null },
          { cityTarget: city },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    return res_.success(res, { ad: ad || null });
  } catch(e) { next(e); }
};

// ── POST /api/feed/ads/:id/impression ────────────────────
const trackImpression = async (req, res, next) => {
  try {
    await prisma.brandAd.update({
      where: { id: req.params.id },
      data:  { impressions: { increment: 1 } },
    });
    return res_.success(res, null);
  } catch(e) { next(e); }
};

// ── POST /api/feed/ads/:id/click ─────────────────────────
const trackClick = async (req, res, next) => {
  try {
    await prisma.brandAd.update({
      where: { id: req.params.id },
      data:  { clicks: { increment: 1 } },
    });
    return res_.success(res, null);
  } catch(e) { next(e); }
};

// ── ADMIN: GET /admin/brand-ads ───────────────────────────
const getAll = async (req, res, next) => {
  try {
    const ads = await prisma.brandAd.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return res_.success(res, { ads });
  } catch(e) { next(e); }
};

// ── ADMIN: POST /admin/brand-ads ──────────────────────────
const create = async (req, res, next) => {
  try {
    const {
      brandName, imageUrl, videoUrl, ctaText,
      ctaUrl, cityTarget, startDate, endDate, frequency,
    } = req.body;

    if (!brandName) return res_.error(res, 'brandName required', 400);
    if (!imageUrl)  return res_.error(res, 'imageUrl required',  400);
    if (!ctaUrl)    return res_.error(res, 'ctaUrl required',    400);
    if (!startDate) return res_.error(res, 'startDate required', 400);
    if (!endDate)   return res_.error(res, 'endDate required',   400);

    const ad = await prisma.brandAd.create({
      data: {
        id:         uuid(),
        brandName,
        imageUrl,
        videoUrl:   videoUrl   || null,
        ctaText:    ctaText    || 'Learn More',
        ctaUrl,
        cityTarget: cityTarget || null,
        startDate:  new Date(startDate),
        endDate:    new Date(endDate),
        frequency:  Number(frequency) || 5,
        createdBy:  req.admin?.id || null,
      },
    });

    return res_.created(res, { ad }, 'Ad created');
  } catch(e) { next(e); }
};

// ── ADMIN: PUT /admin/brand-ads/:id ──────────────────────
const update = async (req, res, next) => {
  try {
    const {
      brandName, imageUrl, videoUrl, ctaText, ctaUrl,
      cityTarget, startDate, endDate, frequency, isActive,
    } = req.body;

    const data = {};
    if (brandName  !== undefined) data.brandName  = brandName;
    if (imageUrl   !== undefined) data.imageUrl   = imageUrl;
    if (videoUrl   !== undefined) data.videoUrl   = videoUrl;
    if (ctaText    !== undefined) data.ctaText    = ctaText;
    if (ctaUrl     !== undefined) data.ctaUrl     = ctaUrl;
    if (cityTarget !== undefined) data.cityTarget = cityTarget || null;
    if (startDate  !== undefined) data.startDate  = new Date(startDate);
    if (endDate    !== undefined) data.endDate    = new Date(endDate);
    if (frequency  !== undefined) data.frequency  = Number(frequency);
    if (isActive   !== undefined) data.isActive   = isActive;

    const ad = await prisma.brandAd.update({
      where: { id: req.params.id },
      data,
    });

    return res_.success(res, { ad }, 'Ad updated');
  } catch(e) { next(e); }
};

// ── ADMIN: DELETE /admin/brand-ads/:id ───────────────────
const remove = async (req, res, next) => {
  try {
    await prisma.brandAd.delete({
      where: { id: req.params.id },
    });
    return res_.success(res, null, 'Ad deleted');
  } catch(e) { next(e); }
};

module.exports = {
  getActiveAd,
  trackImpression,
  trackClick,
  getAll,
  create,
  update,
  remove,
};
