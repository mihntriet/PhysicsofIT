// ============================================================
//  Gas Leak Monitor - Main Server
// ============================================================
//  Entry point: Express + Socket.io + MQTT
//  Serve static frontend từ ../client/
// ============================================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

// ── Config & Services ──
const { initializeFirebase } = require('./config/firebase');
const mqttService = require('./services/mqttService');
const apiRoutes = require('./routes/api');

// ── Khởi tạo Express & HTTP Server ──
const app = express();
const server = http.createServer(app);

// ── Khởi tạo Socket.io ──
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve Static Frontend ──
const clientPath = path.join(__dirname, '..', 'client');
app.use(express.static(clientPath));

// ── API Routes ──
app.use('/api', apiRoutes);

// ── Fallback: Serve index.html cho mọi route ──
app.get('/', (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(clientPath, 'dashboard.html'));
});

// ── Socket.io Connection Handler ──
io.on('connection', (socket) => {
  console.log(`🟢 Client connected: ${socket.id}`);

  // Gửi dữ liệu hiện tại ngay khi client kết nối
  socket.emit('gas-data', {
    value: mqttService.getLatestGasValue ? mqttService.getLatestGasValue() : 0,
    timestamp: Date.now(),
  });

  if (mqttService.getDeviceStates) {
    socket.emit('device-state-all', mqttService.getDeviceStates());
  }

  socket.on('disconnect', () => {
    console.log(`🔴 Client disconnected: ${socket.id}`);
  });
});

// ── Khởi động Server ──
const PORT = process.env.PORT || 3000;

async function startServer() {
  // 1) Khởi tạo Firebase (không block nếu lỗi)
  try {
    initializeFirebase();
  } catch (err) {
    console.warn('⚠️ Firebase init skipped or failed:', err.message);
  }

  // 2) Khởi tạo MQTT Service (truyền Socket.io instance nếu hỗ trợ)
  if (mqttService.init) {
    mqttService.init(io);
  }

  // 3) Start HTTP Server
  server.listen(PORT, () => {
    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log('  🏭  Gas Leak Monitor Server');
    console.log(`  🌐  http://localhost:${PORT}`);
    console.log(`  📊  Dashboard: http://localhost:${PORT}/dashboard`);
    console.log('══════════════════════════════════════════════════');
    console.log('');
  });
}

startServer();

