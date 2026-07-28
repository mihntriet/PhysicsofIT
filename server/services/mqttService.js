// ============================================================
// MQTT Service
// ============================================================
// Quản lý kết nối MQTT Broker, subscribe/publish messages.
// - Subscribe: Nhận dữ liệu gas từ ESP32
// - Publish: Gửi lệnh điều khiển Buzzer/LED xuống ESP32
// ============================================================

const mqtt = require('mqtt');
const firebaseService = require('./firebaseService');
const alertService = require('./alertService');

let mqttClient = null;
let io = null; // Socket.io instance - được inject từ server.js
let latestGasValue = 0;
let deviceStates = {
  buzzer: 'OFF',
  led: 'OFF',
};

/**
 * Khởi tạo kết nối MQTT và đăng ký lắng nghe topics.
 * @param {object} socketIO - Socket.io server instance
 */
function init(socketIO) {
  io = socketIO;

  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://broker.hivemq.com';
  const topicGasData = process.env.MQTT_TOPIC_GAS_DATA || 'gas/sensor/data';

  console.log(`🔌 Connecting to MQTT Broker: ${brokerUrl}`);

  mqttClient = mqtt.connect(brokerUrl, {
    clientId: `gas_monitor_server_${Date.now()}`,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
  });

  // ── Sự kiện kết nối thành công ──
  mqttClient.on('connect', () => {
    console.log('✅ Connected to MQTT Broker');

    // Subscribe topic nhận dữ liệu gas từ ESP32
    mqttClient.subscribe(topicGasData, { qos: 1 }, (err) => {
      if (err) {
        console.error('❌ Failed to subscribe:', topicGasData, err);
      } else {
        console.log(`📡 Subscribed to: ${topicGasData}`);
      }
    });
  });

  // ── Xử lý khi nhận message ──
  mqttClient.on('message', (topic, message) => {
    const topicGas = process.env.MQTT_TOPIC_GAS_DATA || 'gas/sensor/data';

    if (topic === topicGas) {
      handleGasData(message.toString());
    }
  });

  // ── Xử lý lỗi ──
  mqttClient.on('error', (err) => {
    console.error('❌ MQTT Error:', err.message);
  });

  mqttClient.on('reconnect', () => {
    console.log('🔄 Reconnecting to MQTT Broker...');
  });

  mqttClient.on('offline', () => {
    console.warn('⚠️  MQTT Client is offline');
  });
}

/**
 * Xử lý dữ liệu gas nhận từ ESP32.
 * Luồng: Parse JSON → Cập nhật UI (Socket.io) → Lưu Firebase → Kiểm tra ngưỡng
 * @param {string} payload - JSON string: {"value": 1234} hoặc raw number
 */
function handleGasData(payload) {
  try {
    let gasValue;
    const timestamp = Date.now();

    // Hỗ trợ cả JSON và raw number
    try {
      const parsed = JSON.parse(payload);
      gasValue = parsed.value !== undefined ? Number(parsed.value) : Number(parsed);
    } catch {
      gasValue = Number(payload);
    }

    if (isNaN(gasValue)) {
      console.warn('⚠️  Invalid gas data received:', payload);
      return;
    }

    latestGasValue = gasValue;
    const dataPoint = { value: gasValue, timestamp };

    console.log(`🌡️  Gas Value: ${gasValue} (ADC)`);

    // 1) Emit real-time đến tất cả client qua Socket.io
    if (io) {
      io.emit('gas-data', dataPoint);
    }

    // 2) Lưu vào Firebase Database
    firebaseService.saveGasData(dataPoint);

    // 3) Kiểm tra ngưỡng cảnh báo
    const isAlert = alertService.checkThreshold(gasValue);
    if (isAlert && io) {
      io.emit('gas-alert', {
        value: gasValue,
        threshold: alertService.getThreshold(),
        timestamp,
        message: `⚠️ CẢNH BÁO: Nồng độ gas vượt ngưỡng! (${gasValue} > ${alertService.getThreshold()})`,
      });
    }
  } catch (error) {
    console.error('❌ Error handling gas data:', error.message);
  }
}

/**
 * Publish lệnh điều khiển thiết bị qua MQTT.
 * @param {'buzzer'|'led'} device - Thiết bị cần điều khiển
 * @param {'ON'|'OFF'} state - Trạng thái mong muốn
 * @returns {boolean} Thành công hay không
 */
function controlDevice(device, state) {
  if (!mqttClient || !mqttClient.connected) {
    console.error('❌ MQTT Client is not connected');
    return false;
  }

  const topics = {
    buzzer: process.env.MQTT_TOPIC_CONTROL_BUZZER || 'gas/control/buzzer',
    led: process.env.MQTT_TOPIC_CONTROL_LED || 'gas/control/led',
  };

  const topic = topics[device];
  if (!topic) {
    console.error(`❌ Unknown device: ${device}`);
    return false;
  }

  const normalizedState = state.toUpperCase() === 'ON' ? 'ON' : 'OFF';

  mqttClient.publish(topic, normalizedState, { qos: 1 }, (err) => {
    if (err) {
      console.error(`❌ Failed to publish to ${topic}:`, err);
    } else {
      console.log(`📤 Published: ${topic} → ${normalizedState}`);
      deviceStates[device] = normalizedState;

      // Thông báo trạng thái mới đến tất cả clients
      if (io) {
        io.emit('device-state', { device, state: normalizedState });
      }
    }
  });

  return true;
}

/**
 * Lấy giá trị gas mới nhất.
 */
function getLatestGasValue() {
  return latestGasValue;
}

/**
 * Lấy trạng thái các thiết bị.
 */
function getDeviceStates() {
  return { ...deviceStates };
}

module.exports = {
  init,
  controlDevice,
  getLatestGasValue,
  getDeviceStates,
};
