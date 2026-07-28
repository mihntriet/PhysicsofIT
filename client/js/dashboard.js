// ============================================================
// Dashboard Module
// ============================================================
// Logic chính cho trang Dashboard:
// - Kết nối Socket.io nhận data real-time
// - Cập nhật UI giá trị gas + trạng thái thiết bị
// - Khởi tạo và cập nhật Chart.js biểu đồ lịch sử
// - Xử lý cảnh báo khẩn cấp
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // ── Kiểm tra Auth ──
  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = '/';
      return;
    }
    // Hiển thị email user
    const userEmailEl = document.getElementById('user-email');
    if (userEmailEl) {
      userEmailEl.textContent = user.email;
    }
    initDashboard();
  });

  // ── Đăng xuất ──
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await auth.signOut();
      window.location.href = '/';
    });
  }
});

// ══════════════════════════════════════════
// GLOBAL STATE
// ══════════════════════════════════════════
let gasChart = null;
let socket = null;
let gasThreshold = 2000;
const MAX_CHART_POINTS = 60; // Giới hạn số điểm trên biểu đồ

// ══════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════

async function initDashboard() {
  // 1) Lấy dữ liệu hiện tại từ API
  try {
    const current = await getSensorCurrent();
    if (current.success) {
      updateGasDisplay(current.data.gasValue);
      gasThreshold = current.data.threshold;
      updateDeviceUI('buzzer', current.data.devices.buzzer);
      updateDeviceUI('led', current.data.devices.led);
    }
  } catch (err) {
    console.warn('Could not fetch current sensor data:', err);
  }

  // 2) Khởi tạo biểu đồ với dữ liệu lịch sử
  await initChart();

  // 3) Kết nối Socket.io
  initSocketIO();

  // 4) Gắn sự kiện điều khiển thiết bị
  initControls();
}

// ══════════════════════════════════════════
// SOCKET.IO - REAL-TIME DATA
// ══════════════════════════════════════════

function initSocketIO() {
  // Kết nối đến server (same origin)
  socket = io();

  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  socket.on('connect', () => {
    console.log('✅ Socket.io connected');
    if (statusDot) {
      statusDot.className = 'status-dot connected';
    }
    if (statusText) {
      statusText.textContent = 'Đã kết nối';
    }
  });

  socket.on('disconnect', () => {
    console.warn('🔴 Socket.io disconnected');
    if (statusDot) {
      statusDot.className = 'status-dot disconnected';
    }
    if (statusText) {
      statusText.textContent = 'Mất kết nối';
    }
  });

  // ── Nhận dữ liệu gas real-time ──
  socket.on('gas-data', (data) => {
    updateGasDisplay(data.value);
    addChartDataPoint(data.value, data.timestamp);
  });

  // ── Nhận trạng thái thiết bị ──
  socket.on('device-state', (data) => {
    updateDeviceUI(data.device, data.state);
  });

  socket.on('device-state-all', (states) => {
    if (states.buzzer) updateDeviceUI('buzzer', states.buzzer);
    if (states.led) updateDeviceUI('led', states.led);
  });

  // ── Nhận cảnh báo gas ──
  socket.on('gas-alert', (data) => {
    showAlertBanner(data.message);
    showToast(data.message, 'warning');

    // Play alert sound (nếu browser cho phép)
    playAlertSound();
  });
}

// ══════════════════════════════════════════
// GAS VALUE DISPLAY
// ══════════════════════════════════════════

function updateGasDisplay(value) {
  const gasValueEl = document.getElementById('gas-value');
  const thresholdFill = document.getElementById('threshold-fill');
  const thresholdCurrent = document.getElementById('threshold-current');

  if (gasValueEl) {
    gasValueEl.textContent = Math.round(value);

    // Đổi màu khi vượt ngưỡng
    if (value >= gasThreshold) {
      gasValueEl.classList.add('danger');
    } else {
      gasValueEl.classList.remove('danger');
    }
  }

  // Cập nhật thanh progress
  if (thresholdFill) {
    const percentage = Math.min((value / 4095) * 100, 100);
    thresholdFill.style.width = `${percentage}%`;

    if (value >= gasThreshold) {
      thresholdFill.classList.add('danger');
    } else {
      thresholdFill.classList.remove('danger');
    }
  }

  if (thresholdCurrent) {
    thresholdCurrent.textContent = Math.round(value);
  }
}

// ══════════════════════════════════════════
// DEVICE CONTROLS
// ══════════════════════════════════════════

function initControls() {
  // ── Buzzer Toggle ──
  const buzzerToggle = document.getElementById('buzzer-toggle');
  if (buzzerToggle) {
    buzzerToggle.addEventListener('change', async () => {
      const state = buzzerToggle.checked ? 'ON' : 'OFF';
      try {
        const result = await controlBuzzer(state);
        if (result.success) {
          showToast(`Còi Buzzer: ${state === 'ON' ? 'ĐÃ BẬT' : 'ĐÃ TẮT'}`, 'success');
        } else {
          showToast('Không thể điều khiển Buzzer', 'error');
          buzzerToggle.checked = !buzzerToggle.checked;
        }
      } catch (err) {
        showToast('Lỗi kết nối server', 'error');
        buzzerToggle.checked = !buzzerToggle.checked;
      }
    });
  }

  // ── LED Toggle ──
  const ledToggle = document.getElementById('led-toggle');
  if (ledToggle) {
    ledToggle.addEventListener('change', async () => {
      const state = ledToggle.checked ? 'ON' : 'OFF';
      try {
        const result = await controlLed(state);
        if (result.success) {
          showToast(`Đèn LED: ${state === 'ON' ? 'ĐÃ BẬT' : 'ĐÃ TẮT'}`, 'success');
        } else {
          showToast('Không thể điều khiển LED', 'error');
          ledToggle.checked = !ledToggle.checked;
        }
      } catch (err) {
        showToast('Lỗi kết nối server', 'error');
        ledToggle.checked = !ledToggle.checked;
      }
    });
  }
}

function updateDeviceUI(device, state) {
  const toggle = document.getElementById(`${device}-toggle`);
  const statusEl = document.getElementById(`${device}-status-text`);

  if (toggle) {
    toggle.checked = state === 'ON';
  }

  if (statusEl) {
    statusEl.textContent = state === 'ON' ? 'ĐANG BẬT' : 'ĐANG TẮT';
    statusEl.className = `status-text ${state === 'ON' ? 'on' : 'off'}`;
  }
}

// ══════════════════════════════════════════
// CHART.JS - BIỂU ĐỒ LỊCH SỬ
// ══════════════════════════════════════════

async function initChart() {
  const ctx = document.getElementById('gas-chart');
  if (!ctx) return;

  // Lấy dữ liệu lịch sử từ API
  let historyLabels = [];
  let historyValues = [];

  try {
    const history = await getSensorHistory(MAX_CHART_POINTS);
    if (history.success && history.data.length > 0) {
      gasThreshold = history.threshold || gasThreshold;
      historyLabels = history.data.map((d) =>
        new Date(d.timestamp).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
      historyValues = history.data.map((d) => d.value);
    }
  } catch (err) {
    console.warn('Could not load chart history:', err);
  }

  // Cấu hình Chart.js
  gasChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: historyLabels,
      datasets: [
        {
          label: 'Nồng độ Gas (ADC)',
          data: historyValues,
          borderColor: '#00ff88',
          backgroundColor: 'rgba(0, 255, 136, 0.08)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 2,
          pointHoverRadius: 6,
          pointBackgroundColor: '#00ff88',
          pointHoverBackgroundColor: '#00ff88',
          pointBorderColor: 'transparent',
          pointHoverBorderColor: 'rgba(0, 255, 136, 0.3)',
          pointHoverBorderWidth: 8,
        },
        {
          label: 'Ngưỡng cảnh báo',
          data: historyLabels.map(() => gasThreshold),
          borderColor: 'rgba(255, 68, 68, 0.5)',
          borderWidth: 1.5,
          borderDash: [8, 4],
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#94a3b8',
            font: {
              family: "'Inter', sans-serif",
              size: 12,
            },
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 20,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          titleFont: {
            family: "'Inter', sans-serif",
            weight: '600',
          },
          bodyFont: {
            family: "'JetBrains Mono', monospace",
          },
          callbacks: {
            label: function (context) {
              if (context.datasetIndex === 0) {
                return ` Gas: ${context.parsed.y} ADC`;
              }
              return ` Ngưỡng: ${context.parsed.y}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.04)',
            drawBorder: false,
          },
          ticks: {
            color: '#64748b',
            font: { size: 10 },
            maxRotation: 45,
            maxTicksLimit: 12,
          },
        },
        y: {
          min: 0,
          max: 4095,
          grid: {
            color: 'rgba(255, 255, 255, 0.04)',
            drawBorder: false,
          },
          ticks: {
            color: '#64748b',
            font: { size: 11 },
            stepSize: 500,
          },
        },
      },
      animation: {
        duration: 500,
        easing: 'easeOutQuart',
      },
    },
  });

  // Cập nhật giá trị ngưỡng trên UI
  const thresholdValueEl = document.getElementById('threshold-value');
  if (thresholdValueEl) {
    thresholdValueEl.textContent = gasThreshold;
  }
}

/**
 * Thêm một data point mới vào biểu đồ (real-time).
 */
function addChartDataPoint(value, timestamp) {
  if (!gasChart) return;

  const timeLabel = new Date(timestamp).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Thêm label + data
  gasChart.data.labels.push(timeLabel);
  gasChart.data.datasets[0].data.push(value);
  gasChart.data.datasets[1].data.push(gasThreshold);

  // Giới hạn số điểm
  if (gasChart.data.labels.length > MAX_CHART_POINTS) {
    gasChart.data.labels.shift();
    gasChart.data.datasets[0].data.shift();
    gasChart.data.datasets[1].data.shift();
  }

  gasChart.update('none'); // 'none' = không animation khi thêm điểm
}

// ══════════════════════════════════════════
// ALERT BANNER
// ══════════════════════════════════════════

function showAlertBanner(message) {
  const banner = document.getElementById('alert-banner');
  const alertText = document.getElementById('alert-text');

  if (banner && alertText) {
    alertText.textContent = message;
    banner.classList.add('active');

    // Tự động ẩn sau 15 giây
    setTimeout(() => {
      banner.classList.remove('active');
    }, 15000);
  }
}

// Nút đóng alert banner
document.addEventListener('click', (e) => {
  if (e.target.closest('.alert-close')) {
    const banner = document.getElementById('alert-banner');
    if (banner) banner.classList.remove('active');
  }
});

// ══════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════

function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;

  container.appendChild(toast);

  // Tự động xóa sau 5 giây
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

// ══════════════════════════════════════════
// ALERT SOUND
// ══════════════════════════════════════════

function playAlertSound() {
  try {
    // Tạo beep sound bằng Web Audio API
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.8);
  } catch (err) {
    // Audio API không khả dụng
    console.warn('Could not play alert sound:', err);
  }
}

// ══════════════════════════════════════════
// CHART FILTER BUTTONS
// ══════════════════════════════════════════

document.addEventListener('click', async (e) => {
  const chip = e.target.closest('.btn-chip');
  if (!chip) return;

  // Set active state
  document.querySelectorAll('.btn-chip').forEach((c) => c.classList.remove('active'));
  chip.classList.add('active');

  const limit = parseInt(chip.dataset.limit, 10) || 50;

  try {
    const history = await getSensorHistory(limit);
    if (history.success && gasChart) {
      gasChart.data.labels = history.data.map((d) =>
        new Date(d.timestamp).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
      gasChart.data.datasets[0].data = history.data.map((d) => d.value);
      gasChart.data.datasets[1].data = history.data.map(() => gasThreshold);
      gasChart.update();
    }
  } catch (err) {
    showToast('Không thể tải dữ liệu lịch sử', 'error');
  }
});
