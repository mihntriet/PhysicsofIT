// ============================================================
// Alert Service
// ============================================================
// Kiểm tra ngưỡng gas và phát cảnh báo khẩn cấp.
// Giả lập Push Notification (có thể mở rộng FCM sau).
// ============================================================

const GAS_THRESHOLD = parseInt(process.env.GAS_THRESHOLD, 10) || 2000;

// Cooldown: Không spam cảnh báo liên tục (tối thiểu 30 giây giữa 2 lần)
const ALERT_COOLDOWN_MS = 30000;
let lastAlertTime = 0;

/**
 * Kiểm tra giá trị gas có vượt ngưỡng không.
 * Nếu vượt ngưỡng VÀ hết cooldown → phát cảnh báo.
 * @param {number} gasValue - Giá trị ADC từ cảm biến
 * @returns {boolean} true nếu cần cảnh báo
 */
function checkThreshold(gasValue) {
  if (gasValue < GAS_THRESHOLD) {
    return false;
  }

  const now = Date.now();
  if (now - lastAlertTime < ALERT_COOLDOWN_MS) {
    // Vẫn trong cooldown - không cảnh báo lại
    return false;
  }

  lastAlertTime = now;

  // ── Phát cảnh báo ──
  console.log('');
  console.log('🚨 ═══════════════════════════════════════════════');
  console.log(`🚨  CẢNH BÁO KHẨN CẤP: RÒ RỈ KHÍ GAS!`);
  console.log(`🚨  Giá trị hiện tại: ${gasValue} (Ngưỡng: ${GAS_THRESHOLD})`);
  console.log(`🚨  Thời gian: ${new Date().toLocaleString('vi-VN')}`);
  console.log('🚨 ═══════════════════════════════════════════════');
  console.log('');

  // Giả lập Push Notification
  simulatePushNotification(gasValue);

  return true;
}

/**
 * Giả lập gửi Push Notification.
 * Trong thực tế, thay bằng Firebase Cloud Messaging (FCM),
 * Telegram Bot API, hoặc dịch vụ SMS.
 * @param {number} gasValue
 */
function simulatePushNotification(gasValue) {
  const notification = {
    title: '🚨 Cảnh báo rò rỉ khí Gas!',
    body: `Nồng độ gas: ${gasValue} (vượt ngưỡng ${GAS_THRESHOLD}). Kiểm tra ngay!`,
    timestamp: new Date().toISOString(),
    priority: 'HIGH',
  };

  console.log('📲 [PUSH NOTIFICATION] Gửi thông báo:');
  console.log(`   Title: ${notification.title}`);
  console.log(`   Body:  ${notification.body}`);
  console.log('   → Đây là giả lập. Tích hợp FCM/Telegram để gửi thật.');
  console.log('');

  // TODO: Tích hợp thực tế
  // ─ Firebase Cloud Messaging:
  //   admin.messaging().send({ notification, topic: 'gas-alerts' });
  //
  // ─ Telegram Bot:
  //   axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  //     chat_id: CHAT_ID, text: notification.body
  //   });
}

/**
 * Lấy giá trị ngưỡng hiện tại.
 */
function getThreshold() {
  return GAS_THRESHOLD;
}

module.exports = {
  checkThreshold,
  getThreshold,
};
