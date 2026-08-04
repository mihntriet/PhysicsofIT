const { admin, getDatabase } = require('../config/firebase');

const DEVICE_ID = 'ESP32-GAS-MONITOR';

async function saveGasReading(payload) {
  const database = getDatabase();
  const deviceRef = database.ref(`devices/${DEVICE_ID}`);
  const historyRef = deviceRef.child('readings').push();

  if (!historyRef.key) {
    throw new Error('Firebase could not generate a push ID.');
  }

  const record = {
    deviceId: payload.deviceId,
    gasRaw: payload.gasRaw,
    alert: payload.alert,
    ready: payload.ready,
    timestamp: admin.database.ServerValue.TIMESTAMP,
  };

  await deviceRef.update({
    latest: record,
    [`readings/${historyRef.key}`]: record,
  });

  return historyRef.key;
}

module.exports = {
  saveGasReading,
};
