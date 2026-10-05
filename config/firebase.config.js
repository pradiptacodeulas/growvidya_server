const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const path = require('path');
const fs = require('fs');

let firebaseApp = null;
let firebaseMessaging = null;

try {
  let serviceAccount = null;

  // 1. Check for inline JSON string or base64 in environment variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8');
      serviceAccount = JSON.parse(decoded);
    }
  } else {
    // 2. Fall back to local file on disk
    const serviceAccountPath =
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      path.join(__dirname, 'firebase-service-account.json');

    if (fs.existsSync(serviceAccountPath)) {
      serviceAccount = require(serviceAccountPath);
    }
  }

  if (serviceAccount) {
    firebaseApp = getApps().length
      ? getApps()[0]
      : initializeApp({
          credential: cert(serviceAccount),
        });
    firebaseMessaging = getMessaging(firebaseApp);
    console.log('[Firebase Admin]: Initialized successfully for project:', serviceAccount.project_id);
  } else {
    console.warn('[Firebase Admin Warning]: Service account credentials not found. Configure FIREBASE_SERVICE_ACCOUNT_JSON or config/firebase-service-account.json');
  }
} catch (err) {
  console.error('[Firebase Admin Initialization Error]:', err.message);
}

module.exports = { firebaseApp, firebaseMessaging };
