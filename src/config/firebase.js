'use strict';
const admin = require('firebase-admin');

// Firebase service account JSON file chahiye
// Firebase Console → Project Settings → Service Accounts → Generate Key
const serviceAccount = require('../../firebase-service-account.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

module.exports = admin;