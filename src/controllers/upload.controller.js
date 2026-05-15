'use strict';
const { v4: uuid } = require('uuid');
const path   = require('path');
const prisma  = require('../config/db');
const res_    = require('../utils/response');
const { fileUrl } = require('../middleware/upload');

// POST /upload
const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) return res_.error(res, 'No file received', 400);

    const folder   = req.body.folder || 'covers';
    const url      = fileUrl(req, folder, req.file.filename);

    await prisma.upload.create({
      data: {
        id:        uuid(),
        userId:    req.user.id,
        folder,
        filename:  req.file.filename,
        url,
        mimeType:  req.file.mimetype,
        sizeBytes: req.file.size,
      },
    });

    return res_.created(res, { url, filename: req.file.filename, folder }, 'File uploaded');
  } catch (e) { next(e); }
};

module.exports = { uploadFile };
