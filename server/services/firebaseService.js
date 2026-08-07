// ============================================================
// Firebase Database Service
// ============================================================
// Đọc/ghi dữ liệu cảm biến gas vào Firebase Realtime Database.
// Path: /gas_history/{pushId}
// ============================================================

const { admin } = require('../config/firebase');

/**
 * Lưu một data point gas vào node `gas_history` trong Firebase.
 * @param {{ gas_level: number, timestamp: number }} dataPoint
 */
async function saveGasData(dataPoint) {
  try {
    const db = admin.database();
    const ref = db.ref('gas_history');

    await ref.push({
      gas_level: dataPoint.gas_level,
      timestamp: dataPoint.timestamp || Date.now(),
      datetime: new Date(dataPoint.timestamp || Date.now()).toISOString(),
    });
  } catch (error) {
    if (error.code === 'app/no-app') return;
    console.error('❌ Error saving gas data to Firebase:', error.message);
  }
}

/**
 * Lấy lịch sử dữ liệu gas gần nhất từ node `gas_history`.
 * @param {number} limit - Số lượng records cần lấy (mặc định 20)
 * @returns {Array<{gas_level: number, timestamp: number, datetime: string}>}
 */
async function getHistory(limit = 20) {
  try {
    const db = admin.database();
    const ref = db.ref('gas_history');

    const snapshot = await ref
      .orderByChild('timestamp')
      .limitToLast(limit)
      .once('value');

    const data = [];
    snapshot.forEach((child) => {
      const val = child.val();
      data.push({
        id: child.key,
        gas_level: val.gas_level !== undefined ? val.gas_level : val.value,
        timestamp: val.timestamp,
        datetime: val.datetime,
      });
    });

    data.sort((a, b) => a.timestamp - b.timestamp);
    return data;
  } catch (error) {
    if (error.code === 'app/no-app') return [];
    console.error('❌ Error fetching gas history from Firebase:', error.message);
    return [];
  }
}

module.exports = {
  saveGasData,
  getHistory,
};
