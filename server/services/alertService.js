const Pushsafer = require('pushsafer-notifications');

function sendPushsaferAlert(gasRaw) {
  const privateKey = process.env.PUSHSAFER_PRIVATE_KEY;
  const deviceId = process.env.PUSHSAFER_DEVICE_ID;

  if (!privateKey || !deviceId) {
    console.warn('Pushsafer is not configured; alert was recorded without a phone notification.');
    return Promise.resolve({ sent: false, reason: 'not-configured' });
  }

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
    d: deviceId,
    s: '8',
    v: '2',
    i: '5',
    c: '#ff4444',
    pr: '1',
  };

  return new Promise((resolve, reject) => {
    client.send(message, (error, result) => {
      if (error || pushsaferApiError) {
        reject(error || pushsaferApiError);
        return;
      }

      resolve({ sent: true, result });
    });
  });
}

async function handleGasTransition(data, transition) {
  if (!transition.changed
      || transition.previousState !== 'SAFE'
      || data.state !== 'ALERT') {
    return { sent: false, reason: 'not-safe-to-alert-transition' };
  }

  try {
    const result = await sendPushsaferAlert(data.gasRaw);
    if (result.sent) {
      console.log('Pushsafer alert sent for SAFE -> ALERT transition.');
    }
    return result;
  } catch (error) {
    console.error(`Pushsafer error: ${error.message}`);
    return { sent: false, reason: 'send-failed' };
  }
}

module.exports = {
  handleGasTransition,
};
