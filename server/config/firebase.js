const fs = require('fs');
const path = require('path');
const {
  cert,
  deleteApp,
  getApp,
  getApps,
  initializeApp,
} = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getFirestore: getAdminFirestore } = require('firebase-admin/firestore');

function resolveServiceAccountPath(configuredPath) {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(__dirname, '..', configuredPath);
}

function initializeFirebase() {
  if (getApps().length > 0) {
    return getApp();
  }

  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || './config/serviceAccountKey.json';
  const serviceAccountPath = resolveServiceAccountPath(configuredPath);

  if (!databaseURL) {
    throw new Error('Missing FIREBASE_DATABASE_URL in server/.env.');
  }

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Firebase service account file not found: ${serviceAccountPath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

  initializeApp({
    credential: cert(serviceAccount),
    databaseURL,
  });

  console.log('Firebase Admin initialized.');
  return getApp();
}

function isFirebaseInitialized() {
  return getApps().length > 0;
}

function getRealtimeDatabase() {
  if (!isFirebaseInitialized()) {
    throw new Error('Firebase Admin has not been initialized.');
  }

  return getDatabase(getApp());
}

function getFirestore() {
  if (!isFirebaseInitialized()) {
    throw new Error('Firebase Admin has not been initialized.');
  }

  return getAdminFirestore(getApp());
}

function getFirebaseAuth() {
  if (!isFirebaseInitialized()) {
    throw new Error('Firebase Admin has not been initialized.');
  }

  return getAuth(getApp());
}

async function deleteFirebaseApp() {
  if (isFirebaseInitialized()) {
    await deleteApp(getApp());
  }
}

module.exports = {
  initializeFirebase,
  isFirebaseInitialized,
  getRealtimeDatabase,
  getFirestore,
  getFirebaseAuth,
  deleteFirebaseApp,
};
