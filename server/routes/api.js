// ============================================================
// API Routes
// ============================================================
// REST API endpoints cho Front-end gọi:
// - Điều khiển thiết bị (Buzzer, LED)
// - Lấy dữ liệu cảm biến (hiện tại, lịch sử)
// ============================================================

const express = require('express');
const router = express.Router();
const mqttService = require('../services/mqttService');
const firebaseService = require('../services/firebaseService');
const alertService = require('../services/alertService');

// ─────────────────────────────────────────────
// POST /api/control/buzzer (Chức năng cb2)
// Body: { "state": "ON" } hoặc { "state": "OFF" }
// ─────────────────────────────────────────────
router.post('/control/buzzer', (req, res) => {
  const { state } = req.body;

  if (!state || !['ON', 'OFF'].includes(state.toUpperCase())) {
    return res.status(400).json({
      success: false,
      error: 'Invalid state. Use "ON" or "OFF".',
    });
  }

  const normalizedState = state.toUpperCase();
  const result = mqttService.controlDevice('buzzer', normalizedState);

  res.json({
    success: result,
    device: 'buzzer',
    state: normalizedState,
    message: result
      ? `Đã gửi lệnh ${normalizedState} tới Còi Buzzer`
      : 'Không thể gửi lệnh. MQTT chưa kết nối.',
  });
});


// ─────────────────────────────────────────────
// POST /api/control/led
// Body: { "state": "ON" } hoặc { "state": "OFF" }
// ─────────────────────────────────────────────
router.post('/control/led', (req, res) => {
  const { state } = req.body;

  if (!state || !['ON', 'OFF'].includes(state.toUpperCase())) {
    return res.status(400).json({
      success: false,
      error: 'Invalid state. Use "ON" or "OFF".',
    });
  }

  const result = mqttService.controlDevice('led', state);

  res.json({
    success: result,
    device: 'led',
    state: state.toUpperCase(),
    message: result
      ? `LED turned ${state.toUpperCase()}`
      : 'Failed to send command. MQTT not connected.',
  });
});

// ─────────────────────────────────────────────
// GET /api/sensor/current
// Trả về giá trị gas mới nhất + trạng thái thiết bị
// ─────────────────────────────────────────────
router.get('/sensor/current', (req, res) => {
  res.json({
    success: true,
    data: {
      gasValue: mqttService.getLatestGasValue(),
      threshold: alertService.getThreshold(),
      devices: mqttService.getDeviceStates(),
      timestamp: Date.now(),
    },
  });
});

// ─────────────────────────────────────────────
// GET /api/gas-history?limit=20
// Lấy 20 mốc dữ liệu gas gần nhất từ Firebase
// ─────────────────────────────────────────────
router.get('/gas-history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const clampedLimit = Math.min(Math.max(limit, 1), 100);

    const history = await firebaseService.getHistory(clampedLimit);

    res.json({
      success: true,
      count: history.length,
      threshold: alertService.getThreshold(),
      data: history,
    });
  } catch (error) {
    console.error('❌ Error in /api/gas-history:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch gas history.',
    });
  }
});


module.exports = router;
