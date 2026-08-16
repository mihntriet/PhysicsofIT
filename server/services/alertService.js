const Pushsafer = require('pushsafer-notifications');
const { getFirestore } = require('../config/firebase');

function sendPushsaferAlert(gasRaw, privateKey, deviceTargets) {
  let pushsaferApiError = null;
  const client = new Pushsafer({
    k: privateKey,
    debug: false,
    onerror: (message) => {
      pushsaferApiError = new Error(message);
    },
  });
  const message = {
    t: 'Cảnh báo rò rỉ khí gas',
    m: `ESP32 phát hiện mức gas ${gasRaw} ADC. Hãy kiểm tra ngay.`,
    d: deviceTargets,
    s: '8',
    v: '2',
    i: '5',
    c: '#ff4444',
    pr: '1',
  };

  return new Promise((resolve, reject) => {
    client.send(message, (error) => {
      if (error || pushsaferApiError) {
        reject(error || pushsaferApiError);
        return;
      }

      resolve();
    });
  });
}

async function handleGasTransition(data, transition) {
  if (!transition.changed
      || transition.previousState !== 'SAFE'
      || data.state !== 'ALERT') {
    return;
  }

  const privateKey = process.env.PUSHSAFER_PRIVATE_KEY;
  if (!privateKey) {
    console.warn('Pushsafer is not configured; alert was recorded without a phone notification.');
    return;
  }

  try {
    const usersSnapshot = await getFirestore()
      .collection('users')
      .where('productCode', '==', data.deviceId)
      .get();

    const allDeviceIds = new Set();
    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      if (Array.isArray(userData.pushsaferDeviceIds)) {
        userData.pushsaferDeviceIds.forEach((id) => {
          if (id) allDeviceIds.add(String(id));
        });
      }
    });

    if (allDeviceIds.size === 0) {
      console.warn('No Pushsafer devices found for product alert.');
      return;
    }

    const deviceTargets = [...allDeviceIds].join('|');
    await sendPushsaferAlert(data.gasRaw, privateKey, deviceTargets);
    console.log(`Pushsafer alert sent to ${allDeviceIds.size} device(s) for SAFE -> ALERT transition.`);
  } catch (error) {
    console.error(`Pushsafer error: ${error.message}`);
  }
}

module.exports = {
  handleGasTransition,
};
