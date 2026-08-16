const { getRealtimeDatabase } = require('../config/firebase');

function getDevicePath(deviceId, suffix) {
  if (!deviceId) {
    throw new Error('Device ID/Product Code is required for database operations.');
  }
  return `devices/${deviceId}/${suffix}`;
}

async function saveGasData(data) {
  const db = getRealtimeDatabase();
  const timestamp = Date.now();
  const deviceId = data.deviceId;

  const latest = {
    deviceId: deviceId,
    gasRaw: data.gasRaw,
    alert: data.alert,
    ready: data.ready,
    timestamp,
  };

  const updates = {
    [getDevicePath(deviceId, 'latest')]: latest,
    [getDevicePath(deviceId, 'status/gasRaw')]: data.gasRaw,
    [getDevicePath(deviceId, 'status/updatedAt')]: timestamp,
  };

  if (data.ready) {
    const readingKey = db.ref(getDevicePath(deviceId, 'readings')).push().key;
    updates[getDevicePath(deviceId, `readings/${readingKey}`)] = {
      deviceId: deviceId,
      gasRaw: data.gasRaw,
      alert: data.alert,
      timestamp,
    };
  }

  await db.ref().update(updates);
  return latest;
}

async function getGasState(deviceId) {
  const db = getRealtimeDatabase();
  const statusRef = db.ref(getDevicePath(deviceId, 'status/gasState'));
  const previousSnapshot = await statusRef.once('value');
  return previousSnapshot.val() || 'UNKNOWN';
}

async function saveGasAlert(data) {
  const db = getRealtimeDatabase();
  const deviceId = data.deviceId;
  const previousState = await getGasState(deviceId);
  const timestamp = Date.now();
  const changed = previousState !== data.state;

  const updates = {
    [getDevicePath(deviceId, 'status/gasState')]: data.state,
    [getDevicePath(deviceId, 'status/gasRaw')]: data.gasRaw,
    [getDevicePath(deviceId, 'status/updatedAt')]: timestamp,
  };

  if (changed) {
    const alertKey = db.ref(getDevicePath(deviceId, 'alerts')).push().key;
    updates[getDevicePath(deviceId, `alerts/${alertKey}`)] = {
      deviceId: deviceId,
      gasRaw: data.gasRaw,
      state: data.state,
      previousState,
      timestamp,
    };
  }

  await db.ref().update(updates);
  return { changed, previousState, state: data.state, timestamp };
}

async function saveBuzzerStatus(deviceId, data) {
  const db = getRealtimeDatabase();
  const timestamp = Date.now();

  await db.ref(getDevicePath(deviceId, 'status')).update({
    buzzerState: data.state,
    buzzerReason: data.reason,
    updatedAt: timestamp,
  });
}

async function saveLedStatus(deviceId, state) {
    const db = getRealtimeDatabase();
    await db.ref(getDevicePath(deviceId, 'status')).update({
        ledState: state,
        updatedAt: Date.now(),
    });
}

async function saveAvailability(deviceId, availability) {
  const db = getRealtimeDatabase();
  await db.ref(getDevicePath(deviceId, 'status')).update({
    availability,
    updatedAt: Date.now(),
  });
}

async function getLatest(productCode) {
  const snapshot = await getRealtimeDatabase()
    .ref(getDevicePath(productCode, 'latest'))
    .once('value');
  return snapshot.exists() ? snapshot.val() : null;
}

async function getTimestampedItems(productCode, path, limit) {
  const snapshot = await getRealtimeDatabase()
    .ref(getDevicePath(productCode, path))
    .orderByChild('timestamp')
    .limitToLast(limit)
    .once('value');

  const items = [];
  snapshot.forEach((child) => {
    items.push({ id: child.key, ...child.val() });
  });

  return items.sort((a, b) => a.timestamp - b.timestamp);
}

function getHistory(productCode, limit) {
  return getTimestampedItems(productCode, 'readings', limit);
}

function getAlerts(productCode, limit) {
  return getTimestampedItems(productCode, 'alerts', limit);
}

async function getDeviceStatus(productCode) {
  const snapshot = await getRealtimeDatabase()
    .ref(getDevicePath(productCode, 'status'))
    .once('value');
  return snapshot.exists() ? snapshot.val() : null;
}

module.exports = {
  saveGasData,
  getGasState,
  saveGasAlert,
  saveBuzzerStatus,
  saveLedStatus,
  saveAvailability,
  getLatest,
  getHistory,
  getAlerts,
  getDeviceStatus,
};
