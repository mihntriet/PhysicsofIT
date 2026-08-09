const { getRealtimeDatabase } = require('../config/firebase');

const DEVICE_ID = process.env.DEVICE_ID || 'ESP32-GAS-MONITOR';
const HISTORY_SAVE_INTERVAL_MS = Math.max(
  Number.parseInt(process.env.HISTORY_SAVE_INTERVAL_MS, 10) || 30000,
  5000
);

let lastHistorySavedAt = 0;
let lastHistoryAlert = null;

function devicePath(suffix = '') {
  const base = `devices/${DEVICE_ID}`;
  return suffix ? `${base}/${suffix}` : base;
}

async function saveGasData(data) {
  const db = getRealtimeDatabase();
  const timestamp = Date.now();
  const latest = {
    deviceId: data.deviceId,
    gasRaw: data.gasRaw,
    alert: data.alert,
    ready: data.ready,
    timestamp,
  };

  const updates = {
    [devicePath('latest')]: latest,
    [devicePath('status/gasRaw')]: data.gasRaw,
    [devicePath('status/updatedAt')]: timestamp,
  };

  if (data.ready) {
    const alertChanged = lastHistoryAlert !== null && data.alert !== lastHistoryAlert;
    const intervalElapsed = timestamp - lastHistorySavedAt >= HISTORY_SAVE_INTERVAL_MS;

    if (alertChanged || intervalElapsed) {
      const readingKey = db.ref(devicePath('readings')).push().key;
      updates[devicePath(`readings/${readingKey}`)] = {
        deviceId: data.deviceId,
        gasRaw: data.gasRaw,
        alert: data.alert,
        timestamp,
      };
      lastHistorySavedAt = timestamp;
    }

    lastHistoryAlert = data.alert;
  }

  await db.ref().update(updates);
  return latest;
}

async function saveGasAlert(data) {
  const db = getRealtimeDatabase();
  const statusRef = db.ref(devicePath('status/gasState'));
  const previousSnapshot = await statusRef.once('value');
  const previousState = previousSnapshot.val() || 'UNKNOWN';
  const timestamp = Date.now();
  const changed = previousState !== data.state;

  const updates = {
    [devicePath('status/gasState')]: data.state,
    [devicePath('status/gasRaw')]: data.gasRaw,
    [devicePath('status/updatedAt')]: timestamp,
  };

  if (changed) {
    const alertKey = db.ref(devicePath('alerts')).push().key;
    updates[devicePath(`alerts/${alertKey}`)] = {
      deviceId: data.deviceId,
      gasRaw: data.gasRaw,
      state: data.state,
      previousState,
      timestamp,
    };
  }

  await db.ref().update(updates);
  return { changed, previousState, state: data.state, timestamp };
}

async function saveBuzzerStatus(data) {
  const db = getRealtimeDatabase();
  const timestamp = Date.now();

  await db.ref(devicePath('status')).update({
    buzzerState: data.state,
    buzzerReason: data.reason,
    updatedAt: timestamp,
  });
}

async function saveAvailability(availability) {
  const db = getRealtimeDatabase();
  await db.ref(devicePath('status')).update({
    availability,
    updatedAt: Date.now(),
  });
}

async function getLatest() {
  const snapshot = await getRealtimeDatabase()
    .ref(devicePath('latest'))
    .once('value');
  return snapshot.exists() ? snapshot.val() : null;
}

async function getHistory(limit) {
  const snapshot = await getRealtimeDatabase()
    .ref(devicePath('readings'))
    .orderByChild('timestamp')
    .limitToLast(limit)
    .once('value');

  const readings = [];
  snapshot.forEach((child) => {
    readings.push({ id: child.key, ...child.val() });
  });

  return readings.sort((a, b) => a.timestamp - b.timestamp);
}

async function getAlerts(limit) {
  const snapshot = await getRealtimeDatabase()
    .ref(devicePath('alerts'))
    .orderByChild('timestamp')
    .limitToLast(limit)
    .once('value');

  const alerts = [];
  snapshot.forEach((child) => {
    alerts.push({ id: child.key, ...child.val() });
  });

  return alerts.sort((a, b) => a.timestamp - b.timestamp);
}

async function getDeviceStatus() {
  const snapshot = await getRealtimeDatabase()
    .ref(devicePath('status'))
    .once('value');
  return snapshot.exists() ? snapshot.val() : null;
}

module.exports = {
  saveGasData,
  saveGasAlert,
  saveBuzzerStatus,
  saveAvailability,
  getLatest,
  getHistory,
  getAlerts,
  getDeviceStatus,
};
