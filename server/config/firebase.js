const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

let database = null;

function resolveServiceAccountPath(configuredPath) {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(__dirname, '..', configuredPath);
}

function initializeFirebase() {
  if (database) {
    return database;
  }

  const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!configuredPath) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_PATH environment variable.');
  }

  if (!databaseURL) {
    throw new Error('Missing FIREBASE_DATABASE_URL environment variable.');
  }

  const serviceAccountPath = resolveServiceAccountPath(configuredPath);

  try {
    const serviceAccount = JSON.parse(
      fs.readFileSync(serviceAccountPath, 'utf8')
    );

    const app = admin.apps.length > 0
      ? admin.app()
      : admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL,
      });

    database = app.database();
    console.log('Firebase Admin SDK initialized.');
    return database;
  } catch (error) {
    throw new Error(`Firebase initialization failed: ${error.message}`);
  }
}

function getDatabase() {
  if (!database) {
    throw new Error('Firebase has not been initialized.');
  }

  return database;
}

module.exports = {
  admin,
  initializeFirebase,
  getDatabase,
};
