const express = require('express');
const {
  getFirebaseAuth,
  getFirestore,
  isFirebaseInitialized,
} = require('../config/firebase');
const firebaseService = require('../services/firebaseService');
const mqttService = require('../services/mqttService');

const router = express.Router();

function parseLimit(value, defaultValue, maxValue) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.min(Math.max(parsed, 1), maxValue);
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
    if (profile.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Account is waiting for approval.',
        status: profile.status || 'pending',
      });
    }

    req.user = { uid: decodedToken.uid, email: decodedToken.email, profile };
    return next();
  } catch (error) {
    if (error.code && error.code.startsWith('auth/')) {
      return res.status(401).json({ success: false, error: 'Invalid or expired Firebase ID token.' });
    }
    console.error(`Authentication middleware error: ${error.message}`);
    return res.status(503).json({ success: false, error: 'Authentication service unavailable.' });
  }
}

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

router.use(requireActiveUser);

router.get('/gas/latest', async (req, res) => {
  try {
    const latest = await firebaseService.getLatest();
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
    const history = await firebaseService.getHistory(limit);
    return res.json({ success: true, count: history.length, data: history });
  } catch (error) {
    console.error(`GET /api/gas/history failed: ${error.message}`);
    return res.status(503).json({ success: false, error: 'Realtime Database unavailable.' });
  }
});

router.get('/alerts', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 50, 500);
    const alerts = await firebaseService.getAlerts(limit);
    return res.json({ success: true, count: alerts.length, data: alerts });
  } catch (error) {
    console.error(`GET /api/alerts failed: ${error.message}`);
    return res.status(503).json({ success: false, error: 'Realtime Database unavailable.' });
  }
});

router.get('/device/status', async (req, res) => {
  try {
    const persisted = await firebaseService.getDeviceStatus();
    return res.json({
      success: true,
      data: {
        deviceId: process.env.DEVICE_ID || 'ESP32-GAS-MONITOR',
        ...persisted,
        mqtt: mqttService.getMQTTStatus(),
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
    const published = await mqttService.publishBuzzerCommand(command);
    return res.status(202).json({
      success: true,
      data: {
        command: published.command,
        published: true,
        actualState: mqttService.getMQTTStatus().buzzerState,
      },
    });
  } catch (error) {
    return res.status(503).json({ success: false, error: error.message });
  }
});

module.exports = router;
