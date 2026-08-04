const mqtt = require('mqtt');
const firebaseService = require('./firebaseService');

const EXPECTED_DEVICE_ID = 'ESP32-GAS-MONITOR';

let mqttClient = null;

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'payload must be a JSON object';
  }

  if (payload.deviceId !== EXPECTED_DEVICE_ID) {
    return `deviceId must be ${EXPECTED_DEVICE_ID}`;
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

async function handleGasData(message) {
  let payload;

  try {
    payload = JSON.parse(message.toString('utf8'));
  } catch (error) {
    console.error(`Invalid MQTT payload: malformed JSON (${error.message}).`);
    return;
  }

  const validationError = validatePayload(payload);
  if (validationError) {
    console.error(`Invalid MQTT payload: ${validationError}.`);
    return;
  }

  try {
    const pushId = await firebaseService.saveGasReading(payload);
    console.log(`Saved gas reading to Firebase (pushId: ${pushId}).`);
  } catch (error) {
    console.error(`Failed to save gas reading to Firebase: ${error.message}`);
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
