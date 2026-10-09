'use strict';
// ─────────────────────────────────────────────────────────
//  Firebase Admin (push notifications)
//
//  Setup (one time):
//   Firebase Console → Project Settings → Service Accounts → Generate Key
//   Save the JSON as  ./firebase-service-account.json  (project root)
//   or point FIREBASE_SERVICE_ACCOUNT_PATH to it in .env
//
//  If the file is missing the API still runs — push is just skipped
//  (in-app notifications keep working).
// ─────────────────────────────────────────────────────────
const fs     = require('fs');
const path   = require('path');
const logger = require('./logger');

let admin = null;

try {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : path.join(__dirname, '../../firebase-service-account.json');

  if (fs.existsSync(keyPath)) {
    admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(require(keyPath)),
      });
    }
    logger.info('🔔  Firebase push enabled');
  } else {
    logger.warn(`🔕  Firebase service account not found (${keyPath}) — push disabled`);
  }
} catch (e) {
  admin = null;
  logger.error('Firebase init failed — push disabled: ' + e.message);
}

module.exports = admin; // null when push is not configured
