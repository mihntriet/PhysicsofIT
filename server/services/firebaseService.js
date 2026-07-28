// ============================================================
// Firebase Database Service
// ============================================================
// Đọc/ghi dữ liệu cảm biến gas vào Firebase Realtime Database.
// Path: /sensor_data/{pushId}
// ============================================================

const { admin } = require('../config/firebase');

/**
 * Lưu một data point gas vào Firebase Realtime Database.
 * @param {{ value: number, timestamp: number }} dataPoint
 */
async function saveGasData(dataPoint) {
  try {
    const db = admin.database();
    const ref = db.ref('sensor_data');

    await ref.push({
      value: dataPoint.value,
      timestamp: dataPoint.timestamp,
      datetime: new Date(dataPoint.timestamp).toISOString(),
    });
  } catch (error) {
    // Không crash server nếu Firebase chưa cấu hình
    if (error.code === 'app/no-app') {
      // Firebase chưa khởi tạo - im lặng
      return;
    }
    console.error('❌ Error saving gas data to Firebase:', error.message);
  }
}

/**
 * Lấy lịch sử dữ liệu gas gần nhất từ Firebase.
 * @param {number} limit - Số lượng records cần lấy (mặc định 50)
 * @returns {Array<{value: number, timestamp: number, datetime: string}>}
 */
async function getHistory(limit = 50) {
  try {
    const db = admin.database();
    const ref = db.ref('sensor_data');

    const snapshot = await ref
      .orderByChild('timestamp')
      .limitToLast(limit)
      .once('value');

    const data = [];
    snapshot.forEach((child) => {
      data.push({
        id: child.key,
        ...child.val(),
      });
    });

    // Sắp xếp theo thời gian tăng dần
    data.sort((a, b) => a.timestamp - b.timestamp);

    return data;
  } catch (error) {
    if (error.code === 'app/no-app') {
      console.warn('⚠️  Firebase not initialized. Returning empty history.');
      return [];
    }
    console.error('❌ Error fetching gas history from Firebase:', error.message);
    return [];
  }
}

module.exports = {
  saveGasData,
  getHistory,
};
