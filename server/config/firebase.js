// ============================================================
// Firebase Admin SDK Configuration
// ============================================================

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

/**
 * Khởi tạo Firebase Admin SDK và trả về Realtime Database.
 *
 * @returns {admin.database.Database}
 */
function initializeFirebase() {
  // Tránh khởi tạo Firebase nhiều lần
  if (admin.apps.length > 0) {
    return admin.database();
  }

  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!databaseURL) {
    throw new Error(
      "Thiếu FIREBASE_DATABASE_URL trong file server/.env"
    );
  }

  /*
   * Mặc định file khóa nằm tại:
   * server/config/serviceAccountKey.json
   *
   * Không bắt buộc phải khai báo đường dẫn trong .env.
   */
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? resolveServiceAccountPath(
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      )
    : path.join(__dirname, "serviceAccountKey.json");

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      `Không tìm thấy Firebase Service Account tại: ${serviceAccountPath}`
    );
  }

  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL
  });

  console.log("Firebase Admin SDK initialized successfully");
  console.log(`Realtime Database: ${databaseURL}`);

  return admin.database();
}

/**
 * Xử lý đường dẫn được khai báo trong .env.
 * Đường dẫn tương đối được tính từ thư mục server/.
 */
function resolveServiceAccountPath(configuredPath) {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(__dirname, "..", configuredPath);
}

module.exports = {
  admin,
  initializeFirebase
};