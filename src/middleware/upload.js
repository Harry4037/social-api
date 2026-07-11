'use strict';
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const uploadDir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads');

// Ensure upload directories exist
['avatars', 'proofs', 'covers'].forEach(dir => {
  fs.mkdirSync(path.join(uploadDir, dir), { recursive: true });
});

// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     const folder = req.body.folder || 'covers';
//     cb(null, path.join(uploadDir, folder));
//   },
//   filename: (req, file, cb) => {
//     const ext = path.extname(file.originalname).toLowerCase();
//     cb(null, `${uuid()}${ext}`);
//   },
// });

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const folder = req.body.folder || 'covers';

    return {
      folder,
      public_id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    };
  },
});

// const fileFilter = (req, file, cb) => {
//   const allowed = /jpeg|jpg|png|webp/;
//   const ext     = allowed.test(path.extname(file.originalname).toLowerCase());
//   const mime    = allowed.test(file.mimetype);
//   if (ext && mime) return cb(null, true);
//   cb(new Error('Only image files are allowed (jpeg, jpg, png, webp)'));
// };

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);

  if (ext && mime) {
    return cb(null, true);
  }

  cb(new Error('Only image files are allowed (jpeg, jpg, png, webp)'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

/** Returns the public URL for a stored file */
// const fileUrl = (req, folder, filename) => {
//   const baseUrl = `${req.protocol}://${req.get('host')}`;
//   return `${baseUrl}/uploads/${folder}/${filename}`;
// };

const fileUrl = (req, folder, filename) => {
  // return cloudinary.url(`${folder}/${filename}`, {
  return cloudinary.url(`${filename}`, {
    secure: true,
  });
};

// const fileUrl = (req, folder, filename) => {
//   return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${folder}/${filename}`;
// };

module.exports = { upload, fileUrl };
