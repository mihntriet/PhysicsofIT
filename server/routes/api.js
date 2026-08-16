const express = require('express');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
const {
  getFirebaseAuth,
  getFirestore,
  isFirebaseInitialized,
} = require('../config/firebase');
const firebaseService = require('../services/firebaseService');
const mqttService = require('../services/mqttService');

const router = express.Router();
const pendingPairs = new Map();
const PAIR_ALPHABET = 'ABCDEFHJKLMNPQRTUVWXYZ23456789';

function parseLimit(value, defaultValue, maxValue) {
  const parsed = /^[+-]?\d+$/.test(String(value).trim()) ? Number(value) : NaN;
  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }
  return Math.min(Math.max(parsed, 1), maxValue);
}

function generatePairCode() {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += PAIR_ALPHABET[bytes[i] % PAIR_ALPHABET.length];
  }
  return code;
}

async function requireActiveUser(req, res, next) {
  const authorization = req.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ success: false, error: 'Firebase ID token is required.' });
  }

  try {
    const decodedToken = await getFirebaseAuth().verifyIdToken(match[1]);
    const profileSnapshot = await getFirestore()
      .collection('users')
      .doc(decodedToken.uid)
      .get();

    if (!profileSnapshot.exists) {
      return res.status(403).json({ success: false, error: 'User profile does not exist.' });
    }

    const profile = profileSnapshot.data();
    const productCode = profile.productCode;
    if (!productCode) {
      return res.status(403).json({ success: false, error: 'No product assigned.' });
    }

    const productSnapshot = await getFirestore()
      .collection('products')
      .doc(productCode)
      .get();

    if (!productSnapshot.exists || !productSnapshot.data().enabled) {
      return res.status(403).json({ success: false, error: 'Product not found or disabled.' });
    }

    req.uid = decodedToken.uid;
    req.productCode = productCode;
    return next();
  } catch (error) {
    if (error.code && error.code.startsWith('auth/')) {
      return res.status(401).json({ success: false, error: 'Invalid or expired Firebase ID token.' });
    }
    console.error(`Authentication middleware error: ${error.message}`);
    return res.status(503).json({ success: false, error: 'Authentication service unavailable.' });
  }
}

// ─── Public endpoints ───

router.get('/health', (req, res) => {
  const mqttStatus = mqttService.getMQTTStatus();
  res.json({
    success: true,
    data: {
      server: 'UP',
      firebase: isFirebaseInitialized() ? 'READY' : 'NOT_READY',
      mqtt: { brokerConnected: mqttStatus.brokerConnected },
      timestamp: Date.now(),
    },
  });
});

router.post('/product/validate', async (req, res) => {
  const code = typeof req.body.productCode === 'string'
    ? req.body.productCode.trim().toUpperCase()
    : '';

  if (!code || code.length !== 6) {
    return res.json({ valid: false });
  }

  try {
    const doc = await getFirestore().collection('products').doc(code).get();
    return res.json({ valid: doc.exists && doc.data().enabled === true });
  } catch (error) {
    console.error(`Product validation failed: ${error.message}`);
    return res.status(503).json({ valid: false });
  }
});

router.post('/user/profile', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized.' });
  }

  const token = authHeader.split('Bearer ')[1];
  const { productCode } = req.body;

  if (!productCode || typeof productCode !== 'string' || productCode.length !== 6) {
    return res.status(400).json({ success: false, error: 'Mã sản phẩm không hợp lệ.' });
  }

  try {
    const decodedToken = await getFirebaseAuth().verifyIdToken(token);
    const code = productCode.toUpperCase();

    const productDoc = await getFirestore().collection('products').doc(code).get();
    if (!productDoc.exists || productDoc.data().enabled !== true) {
      return res.status(400).json({ success: false, error: 'Mã sản phẩm không tồn tại hoặc đã bị vô hiệu hóa.' });
    }

    await getFirestore().collection('users').doc(decodedToken.uid).set({
      email: decodedToken.email || '',
      productCode: code,
      createdAt: FieldValue.serverTimestamp(),
    });

    return res.json({ success: true });
  } catch (error) {
    console.error(`POST /api/user/profile error: ${error.message}`);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Protected endpoints ───

router.use(requireActiveUser);

router.get('/gas/latest', async (req, res) => {
  try {
    const latest = await firebaseService.getLatest(req.productCode);
    if (!latest) {
      return res.status(404).json({ success: false, error: 'No gas data is available yet.' });
    }
    return res.json({ success: true, data: latest });
  } catch (error) {
    console.error(`GET /api/gas/latest failed: ${error.message}`);
    return res.status(503).json({ success: false, error: 'Realtime Database unavailable.' });
  }
});

router.get('/gas/history', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 100, 500);
    const history = await firebaseService.getHistory(req.productCode, limit);
    return res.json({ success: true, count: history.length, data: history });
  } catch (error) {
    console.error(`GET /api/gas/history failed: ${error.message}`);
    return res.status(503).json({ success: false, error: 'Realtime Database unavailable.' });
  }
});

router.get('/alerts', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 50, 500);
    const alerts = await firebaseService.getAlerts(req.productCode, limit);
    return res.json({ success: true, count: alerts.length, data: alerts });
  } catch (error) {
    console.error(`GET /api/alerts failed: ${error.message}`);
    return res.status(503).json({ success: false, error: 'Realtime Database unavailable.' });
  }
});

router.get('/device/status', async (req, res) => {
  try {
    const persisted = await firebaseService.getDeviceStatus(req.productCode);
    const deviceState = mqttService.getDeviceState(req.productCode);
    return res.json({
      success: true,
      data: {
        deviceId: req.productCode,
        ...persisted,
        mqtt: {
          brokerConnected: mqttService.getMQTTStatus().brokerConnected,
          ...deviceState,
        },
      },
    });
  } catch (error) {
    console.error(`GET /api/device/status failed: ${error.message}`);
    return res.status(503).json({ success: false, error: 'Device status unavailable.' });
  }
});

router.post('/buzzer', async (req, res) => {
  const command = typeof req.body.command === 'string'
    ? req.body.command.trim().toUpperCase()
    : '';

  if (!['ON', 'OFF'].includes(command)) {
    return res.status(400).json({ success: false, error: 'command must be ON or OFF.' });
  }

  try {
    const published = await mqttService.publishBuzzerCommand(req.productCode, command);
    const deviceState = mqttService.getDeviceState(req.productCode);
    return res.status(202).json({
      success: true,
      data: {
        command: published.command,
        published: true,
        actualState: deviceState.buzzerState,
      },
    });
  } catch (error) {
    console.error(`POST /api/buzzer failed: ${error.message}`);
    return res.status(503).json({ success: false, error: 'MQTT service unavailable.' });
  }
});

router.post('/led', async (req, res) => {
  const command = typeof req.body.command === 'string'
    ? req.body.command.trim().toUpperCase()
    : '';

  if (!['ON', 'OFF'].includes(command)) {
    return res.status(400).json({ success: false, error: 'command must be ON or OFF.' });
  }

  try {
    const published = await mqttService.publishLedCommand(req.productCode, command);
    return res.status(202).json({
      success: true,
      data: { command: published.command, published: true },
    });
  } catch (error) {
    console.error(`POST /api/led failed: ${error.message}`);
    return res.status(503).json({ success: false, error: 'MQTT service unavailable.' });
  }
});

router.post('/device/wifi-config', async (req, res) => {
  try {
    const published = await mqttService.publishWifiConfigCommand(req.productCode);
    return res.status(202).json({
      success: true,
      data: { command: published.command, published: true },
    });
  } catch (error) {
    console.error(`POST /api/device/wifi-config failed: ${error.message}`);
    return res.status(503).json({ success: false, error: 'MQTT service unavailable.' });
  }
});

router.post('/pushsafer/pair/start', (req, res) => {
  const guestId = process.env.PUSHSAFER_GUEST_ID;
  if (!guestId) {
    return res.status(503).json({ success: false, error: 'Pushsafer not configured.' });
  }

  const code = generatePairCode();
  pendingPairs.set(req.uid, code);

  return res.json({ success: true, data: { guestId, code } });
});

router.post('/pushsafer/pair/confirm', async (req, res) => {
  const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';

  const expectedCode = pendingPairs.get(req.uid);
  if (!expectedCode || expectedCode !== code) {
    return res.status(400).json({ success: false, error: 'Mã không hợp lệ hoặc đã hết hạn.' });
  }

  const privateKey = process.env.PUSHSAFER_PRIVATE_KEY;
  if (!privateKey) {
    return res.status(503).json({ success: false, error: 'Pushsafer not configured.' });
  }

  try {
    let foundDeviceId = null;

    // 1. Try /api-de endpoint
    try {
      const response = await fetch(`https://www.pushsafer.com/api-de?k=${encodeURIComponent(privateKey)}`);
      const data = await response.json();
      if (data && typeof data === 'object' && !data.error) {
        for (const [key, device] of Object.entries(data)) {
          if (key === 'a' || typeof device !== 'object') continue;
          if (String(device.name).toUpperCase().includes(code) && String(device.isguest) === '1') {
            foundDeviceId = String(device.id);
            break;
          }
        }
      }
    } catch (_) {}

    // 2. Fallback: Send a welcome notification via Pushsafer API which returns target device ID in message_ids
    if (!foundDeviceId) {
      const params = new URLSearchParams({
        k: privateKey,
        t: 'Gas Monitor System',
        m: `Xác nhận ghép nối thiết bị thành công (Mã: ${code})`,
        s: '11',
        v: '1',
        i: '10',
      });
      const response = await fetch('https://www.pushsafer.com/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const data = await response.json();
      if (data && data.status === 1 && data.message_ids) {
        const parts = String(data.message_ids).split(',')[0].split(':');
        if (parts.length >= 2 && parts[1]) {
          foundDeviceId = parts[1].trim();
        }
      }
    }

    if (!foundDeviceId) {
      return res.status(404).json({
        success: false,
        error: 'Chưa tìm thấy thiết bị. Hãy đăng ký Guest Device trước rồi xác nhận lại.',
      });
    }

    await getFirestore()
      .collection('users')
      .doc(req.uid)
      .update({
        pushsaferDeviceIds: FieldValue.arrayUnion(foundDeviceId),
      });

    pendingPairs.delete(req.uid);

    return res.json({ success: true, data: { deviceId: foundDeviceId } });
  } catch (error) {
    console.error(`Pushsafer pair confirm failed: ${error.message}`);
    return res.status(503).json({ success: false, error: 'Pushsafer service error.' });
  }
});

module.exports = router;
