const mqtt = require('mqtt');
const firebaseService = require('./firebaseService');
const alertService = require('./alertService');

let mqttClient = null;
let io = null;
let latestGasValue = 0;
let deviceStates = {
  buzzer: 'OFF',
  led: 'OFF',
};

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'payload must be a JSON object';
  }


  if (typeof payload.gasRaw !== 'number'
      || !Number.isFinite(payload.gasRaw)
      || payload.gasRaw < 0) {
    return 'gasRaw must be a finite, non-negative number';
  }

  if (typeof payload.alert !== 'boolean') {
    return 'alert must be a boolean';
  }

  if (typeof payload.ready !== 'boolean') {
    return 'ready must be a boolean';
  }

  return null;
}

/**
 * Xử lý dữ liệu gas nhận từ ESP32.
 * Luồng: Parse JSON -> Emit Socket.io 'update_gas_data' -> Lưu Firebase -> Kiểm tra ngưỡng
 * @param {string} payload - JSON string: {"gas_level": 1250}
 */
function handleGasData(payload) {
  try {
    let gasLevel;
    const timestamp = Date.now();

    try {
      const parsed = JSON.parse(payload);
      if (parsed.gas_level !== undefined) {
        gasLevel = Number(parsed.gas_level);
      } else if (parsed.value !== undefined) {
        gasLevel = Number(parsed.value);
      } else {
        gasLevel = Number(payload);
      }
    } catch {
      gasLevel = Number(payload);
    }

    if (isNaN(gasLevel)) {
      console.warn('⚠️ Invalid gas data received:', payload);
      return;
    }

    latestGasValue = gasLevel;
    const dataPoint = { gas_level: gasLevel, timestamp };

    console.log(`🌡️ Gas Level: ${gasLevel} (ADC)`);

    // 1) Việc 1: Emit real-time qua Socket.io tên `update_gas_data`
    if (io) {
      io.emit('update_gas_data', dataPoint);
      io.emit('gas-data', { value: gasLevel, timestamp });
    }

    // 2) Việc 2: Lưu vào node gas_history trong Firebase
    firebaseService.saveGasData(dataPoint);

    // 3) Kiểm tra ngưỡng cảnh báo
    const isAlert = alertService.checkThreshold(gasLevel);
    if (isAlert && io) {
      io.emit('gas-alert', {
        value: gasLevel,
        threshold: alertService.getThreshold(),
        timestamp,
        message: `⚠️ CẢNH BÁO: Nồng độ gas vượt ngưỡng! (${gasLevel} > ${alertService.getThreshold()})`,
      });
    }
  } catch (error) {
    console.error('❌ Error handling gas data:', error.message);
  }
}


function init() {
  if (mqttClient) {
    return mqttClient;
  }

  const brokerUrl = process.env.MQTT_BROKER_URL;
  const gasDataTopic = process.env.MQTT_TOPIC_GAS_DATA;

  if (!brokerUrl) {
    throw new Error('Missing MQTT_BROKER_URL environment variable.');
  }

  if (!gasDataTopic) {
    throw new Error('Missing MQTT_TOPIC_GAS_DATA environment variable.');
  }

  mqttClient = mqtt.connect(brokerUrl, {
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
  });

  mqttClient.on('connect', () => {
    console.log(`Connected to MQTT broker: ${brokerUrl}`);

    mqttClient.subscribe(gasDataTopic, { qos: 1 }, (error) => {
      if (error) {
        console.error(`Failed to subscribe to ${gasDataTopic}: ${error.message}`);
        return;
      }

      console.log(`Subscribed to MQTT topic: ${gasDataTopic}`);
    });
  });

  mqttClient.on('message', (topic, message) => {
    if (topic !== gasDataTopic) {
      return;
    }

    void handleGasData(message);
  });

  mqttClient.on('reconnect', () => {
    console.log('Reconnecting to MQTT broker...');
  });

  mqttClient.on('offline', () => {
    console.warn('MQTT client is offline.');
  });

  mqttClient.on('error', (error) => {
    console.error(`MQTT error: ${error.message}`);
  });

  return mqttClient;
}

module.exports = {
  init,
  handleGasData,
  validatePayload,
};
