// ============================================================
// Firebase Admin SDK Configuration
// ============================================================
// Khởi tạo Firebase Admin để server có quyền đọc/ghi database
// mà không cần auth token từ client.
// ============================================================

const admin = require('firebase-admin');
const path = require('path');

/**
 * Khởi tạo Firebase Admin SDK.
 * Đọc Service Account Key từ file JSON được chỉ định trong .env
 */
function initializeFirebase() {
  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      || './config/serviceAccountKey.json';

    const serviceAccount = require(path.resolve(serviceAccountPath));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });

    console.log('✅ Firebase Admin SDK initialized successfully');
  } catch (error) {
    console.error('❌ Firebase Admin SDK initialization failed:', error.message);
    console.warn('⚠️  Server will run without Firebase. Data will NOT be persisted.');
    console.warn('   → Download Service Account Key from Firebase Console');
    console.warn('   → Place it at: server/config/serviceAccountKey.json');
  }
}

module.exports = { admin, initializeFirebase };
