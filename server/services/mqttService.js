const mqtt = require('mqtt');

let client = null;
let handlers = {};
let handlerChain = Promise.resolve();

const status = {
  brokerConnected: false,
  availability: 'UNKNOWN',
  buzzerState: 'UNKNOWN',
  buzzerReason: 'UNKNOWN',
  lastMessageAt: null,
};

function getConfig() {
  const deviceId = process.env.DEVICE_ID || 'ESP32-GAS-MONITOR';
  const required = {
    brokerUrl: process.env.MQTT_BROKER_URL,
    gasData: process.env.MQTT_TOPIC_GAS_DATA,
    gasAlert: process.env.MQTT_TOPIC_GAS_ALERT,
    buzzerControl: process.env.MQTT_TOPIC_CONTROL_BUZZER,
    buzzerState: process.env.MQTT_TOPIC_BUZZER_STATE,
    availability: process.env.MQTT_TOPIC_AVAILABILITY,
  };

  for (const [name, value] of Object.entries(required)) {
    if (!value) {
      throw new Error(`Missing MQTT configuration: ${name}`);
    }
  }

  return {
    ...required,
    deviceId,
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
  };
}

function parseJson(message) {
  try {
    const parsed = JSON.parse(message.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function validDeviceAndGas(payload, deviceId) {
  return payload
    && payload.deviceId === deviceId
    && typeof payload.gasRaw === 'number'
    && Number.isFinite(payload.gasRaw)
    && payload.gasRaw >= 0;
}

function validateGasData(message, deviceId) {
  const payload = parseJson(message);
  if (!validDeviceAndGas(payload, deviceId)
      || typeof payload.alert !== 'boolean'
      || typeof payload.ready !== 'boolean') {
    return null;
  }
  return payload;
}

function validateGasAlert(message, deviceId) {
  const payload = parseJson(message);
  if (!validDeviceAndGas(payload, deviceId)
      || !['ALERT', 'SAFE'].includes(payload.state)) {
    return null;
  }
  return payload;
}

function validateBuzzerStatus(message) {
  const payload = parseJson(message);
  if (!payload
      || !['ON', 'OFF'].includes(payload.state)
      || !['GAS_ALARM', 'REMOTE', 'NONE'].includes(payload.reason)) {
    return null;
  }
  return payload;
}

function invokeHandler(name, payload) {
  if (typeof handlers[name] !== 'function') {
    return;
  }

  // Preserve broker message order so SAFE -> ALERT transitions cannot race in Firebase.
  handlerChain = handlerChain
    .then(() => handlers[name](payload))
    .catch((error) => {
      console.error(`MQTT ${name} handler failed: ${error.message}`);
    });
}

function handleMessage(topic, message, config) {
  status.lastMessageAt = Date.now();

  if (topic === config.gasData) {
    const payload = validateGasData(message, config.deviceId);
    if (!payload) {
      console.warn(`Ignored invalid MQTT gas payload on ${topic}.`);
      return;
    }
    invokeHandler('onGasData', payload);
    return;
  }

  if (topic === config.gasAlert) {
    const payload = validateGasAlert(message, config.deviceId);
    if (!payload) {
      console.warn(`Ignored invalid MQTT gas alert on ${topic}.`);
      return;
    }
    invokeHandler('onGasAlert', payload);
    return;
  }

  if (topic === config.buzzerState) {
    const payload = validateBuzzerStatus(message);
    if (!payload) {
      console.warn(`Ignored invalid MQTT buzzer status on ${topic}.`);
      return;
    }
    status.buzzerState = payload.state;
    status.buzzerReason = payload.reason;
    invokeHandler('onBuzzerStatus', payload);
    return;
  }

  if (topic === config.availability) {
    const availability = message.toString('utf8').trim().toUpperCase();
    if (!['ONLINE', 'OFFLINE'].includes(availability)) {
      console.warn(`Ignored invalid MQTT availability on ${topic}.`);
      return;
    }
    status.availability = availability;
    invokeHandler('onAvailability', availability);
  }
}

function startMQTT(eventHandlers = {}) {
  if (client) {
    return client;
  }

  const config = getConfig();
  handlers = eventHandlers;
  handlerChain = Promise.resolve();

  client = mqtt.connect(config.brokerUrl, {
    clientId: `gas-monitor-server-${process.pid}`,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
    username: config.username,
    password: config.password,
  });

  client.on('connect', () => {
    status.brokerConnected = true;
    console.log(`Connected to Mosquitto at ${config.brokerUrl}.`);

    const topics = [
      config.gasData,
      config.gasAlert,
      config.buzzerState,
      config.availability,
    ];

    client.subscribe(topics, { qos: 1 }, (error) => {
      if (error) {
        console.error(`MQTT subscribe failed: ${error.message}`);
        return;
      }
      console.log(`Subscribed to ${topics.length} device topics.`);
    });

  });

  client.on('message', (topic, message) => handleMessage(topic, message, config));
  client.on('reconnect', () => console.log('Reconnecting to Mosquitto...'));
  client.on('offline', () => {
    status.brokerConnected = false;
    status.availability = 'UNKNOWN';
    status.buzzerState = 'UNKNOWN';
    status.buzzerReason = 'UNKNOWN';
    console.warn('Mosquitto connection is offline.');
  });
  client.on('close', () => {
    status.brokerConnected = false;
    status.availability = 'UNKNOWN';
    status.buzzerState = 'UNKNOWN';
    status.buzzerReason = 'UNKNOWN';
  });
  client.on('error', (error) => {
    console.error(`MQTT error: ${error.message}`);
  });

  return client;
}

function publishBuzzerCommand(command) {
  if (!['ON', 'OFF'].includes(command)) {
    return Promise.reject(new Error('Buzzer command must be ON or OFF.'));
  }

  if (!client || !client.connected) {
    return Promise.reject(new Error('Mosquitto is not connected.'));
  }

  const topic = getConfig().buzzerControl;
  return new Promise((resolve, reject) => {
    client.publish(topic, command, { qos: 1, retain: false }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ topic, command });
    });
  });
}

function getMQTTStatus() {
  return { ...status };
}

async function stopMQTT() {
  await handlerChain;

  if (client) {
    const activeClient = client;
    client = null;
    await new Promise((resolve) => activeClient.end(false, {}, resolve));
  }

  handlers = {};
  handlerChain = Promise.resolve();
  status.brokerConnected = false;
  status.availability = 'UNKNOWN';
  status.buzzerState = 'UNKNOWN';
  status.buzzerReason = 'UNKNOWN';
}

module.exports = {
  startMQTT,
  stopMQTT,
  publishBuzzerCommand,
  getMQTTStatus,
  validateGasData,
};
