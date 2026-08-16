const mqtt = require('mqtt');

let client = null;
let handlers = {};
let handlerChain = Promise.resolve();
let reconnectNoticeShown = false;
let lastConnectionError = null;
let brokerConnected = false;

const deviceStates = new Map();

function getOrCreateDeviceState(deviceId) {
  if (!deviceStates.has(deviceId)) {
    deviceStates.set(deviceId, {
      availability: 'UNKNOWN',
      buzzerState: 'UNKNOWN',
      buzzerReason: 'UNKNOWN',
      ledState: 'UNKNOWN',
      lastMessageAt: null,
    });
  }
  return deviceStates.get(deviceId);
}

function resetLiveStatus() {
  brokerConnected = false;
  deviceStates.clear();
}

function handleDisconnect() {
  const wasConnected = brokerConnected;
  resetLiveStatus();
  if (wasConnected) {
    console.log('[MQTT] Disconnected');
  }
}

function getConfig() {
  const required = {
    brokerUrl: process.env.MQTT_BROKER_URL,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
  };

  for (const [name, value] of Object.entries(required)) {
    if (!value) {
      throw new Error(`Missing MQTT configuration: ${name}`);
    }
  }

  let brokerUrl;
  try {
    brokerUrl = new URL(required.brokerUrl);
  } catch {
    throw new Error('MQTT_BROKER_URL must be a valid mqtts:// URL.');
  }

  if (brokerUrl.protocol !== 'mqtts:' || brokerUrl.port !== '8883') {
    throw new Error('MQTT_BROKER_URL must use mqtts:// and port 8883.');
  }

  return required;
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

function parseTopic(topic) {
  const parts = topic.split('/');
  if (parts.length !== 4 || parts[0] !== 'devices') return null;
  return { deviceId: parts[1], category: parts[2], type: parts[3] };
}

function validateGasData(message, deviceId) {
  const payload = parseJson(message);
  if (!payload
      || payload.deviceId !== deviceId
      || typeof payload.gasRaw !== 'number'
      || !Number.isFinite(payload.gasRaw)
      || payload.gasRaw < 0
      || typeof payload.alert !== 'boolean'
      || typeof payload.ready !== 'boolean') {
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

function handleMessage(topic, message) {
  const parsed = parseTopic(topic);
  if (!parsed) return;

  const { deviceId, category, type } = parsed;
  const state = getOrCreateDeviceState(deviceId);
  state.lastMessageAt = Date.now();

  if (category === 'gas' && type === 'data') {
    const payload = validateGasData(message, deviceId);
    if (!payload) {
      console.warn(`Ignored invalid MQTT gas payload on ${topic}.`);
      return;
    }
    invokeHandler('onGasData', payload);
    return;
  }

  if (category === 'status' && type === 'buzzer') {
    const payload = validateBuzzerStatus(message);
    if (!payload) {
      console.warn(`Ignored invalid MQTT buzzer status on ${topic}.`);
      return;
    }
    state.buzzerState = payload.state;
    state.buzzerReason = payload.reason;
    invokeHandler('onBuzzerStatus', { deviceId, ...payload });
    return;
  }

  if (category === 'status' && type === 'led') {
    const ledState = message.toString('utf8').trim().toUpperCase();
    if (!['ON', 'OFF'].includes(ledState)) {
      console.warn(`Ignored invalid MQTT LED status on ${topic}.`);
      return;
    }
    state.ledState = ledState;
    invokeHandler('onLedStatus', { deviceId, state: ledState });
    return;
  }

  if (category === 'status' && type === 'availability') {
    const availability = message.toString('utf8').trim().toUpperCase();
    if (!['ONLINE', 'OFFLINE'].includes(availability)) {
      console.warn(`Ignored invalid MQTT availability on ${topic}.`);
      return;
    }
    state.availability = availability;
    invokeHandler('onAvailability', { deviceId, availability });
  }
}

function startMQTT(eventHandlers = {}) {
  if (client) {
    return;
  }

  const config = getConfig();
  handlers = eventHandlers;
  handlerChain = Promise.resolve();
  reconnectNoticeShown = false;
  lastConnectionError = null;

  console.log('[MQTT] Connecting...');
  client = mqtt.connect(config.brokerUrl, {
    clientId: `gas-monitor-server-${process.pid}`,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
    resubscribe: false,
    username: config.username,
    password: config.password,
  });

  client.on('connect', () => {
    brokerConnected = true;
    reconnectNoticeShown = false;
    lastConnectionError = null;
    console.log('[MQTT] Connected');

    const topics = [
      'devices/+/gas/data',
      'devices/+/status/buzzer',
      'devices/+/status/led',
      'devices/+/status/availability',
    ];

    client.subscribe(topics, { qos: 1 }, (error) => {
      if (error) {
        console.error(`[MQTT] Error: subscribe failed: ${error.message}`);
      }
    });
  });

  client.on('message', (topic, message) => handleMessage(topic, message));
  client.on('reconnect', () => {
    if (!reconnectNoticeShown) {
      console.log('[MQTT] Reconnecting...');
      reconnectNoticeShown = true;
    }
  });
  client.on('offline', handleDisconnect);
  client.on('close', handleDisconnect);
  client.on('error', (error) => {
    const message = String(error.message || '').trim();
    if (!message || message === lastConnectionError) return;
    console.error(`[MQTT] Error: ${message}`);
    lastConnectionError = message;
  });
}

function publishCommand(topic, command) {
  if (!client || !client.connected) {
    return Promise.reject(new Error('MQTT is not connected.'));
  }
  return new Promise((resolve, reject) => {
    client.publish(topic, command, { qos: 1, retain: false }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ command });
    });
  });
}

function publishBuzzerCommand(productCode, command) {
  if (!['ON', 'OFF'].includes(command)) {
    return Promise.reject(new Error('Buzzer command must be ON or OFF.'));
  }
  return publishCommand(`devices/${productCode}/control/buzzer`, command);
}

function publishLedCommand(productCode, command) {
  if (!['ON', 'OFF'].includes(command)) {
    return Promise.reject(new Error('LED command must be ON or OFF.'));
  }
  return publishCommand(`devices/${productCode}/control/led`, command);
}

function publishWifiConfigCommand(productCode) {
  return publishCommand(`devices/${productCode}/control/wifi-config`, 'START');
}

function getMQTTStatus() {
  return { brokerConnected };
}

function getDeviceState(productCode) {
  if (!deviceStates.has(productCode)) {
    return {
      availability: 'UNKNOWN',
      buzzerState: 'UNKNOWN',
      buzzerReason: 'UNKNOWN',
      ledState: 'UNKNOWN',
      lastMessageAt: null,
    };
  }
  return { ...deviceStates.get(productCode) };
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
  reconnectNoticeShown = false;
  lastConnectionError = null;
  resetLiveStatus();
}

module.exports = {
  startMQTT,
  stopMQTT,
  publishBuzzerCommand,
  publishLedCommand,
  publishWifiConfigCommand,
  getMQTTStatus,
  getDeviceState,
};
