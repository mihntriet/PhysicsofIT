const GAS_ALERT_THRESHOLD = 2500;
const ADC_MAX = 4095;
const LIVE_POLL_INTERVAL_MS = 5000;
const HISTORY_POLL_INTERVAL_MS = 30000;
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

let gasChart = null;
let initialized = false;
let polling = false;
let lastBuzzerState = 'UNKNOWN';
let latestAlertId = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await auth.signOut();
    window.location.href = '/';
  });

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = '/';
      return;
    }
    if (initialized) return;

    try {
      const profileSnapshot = await firestore.collection('users').doc(user.uid).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      if (!profile || profile.status !== 'active') {
        await auth.signOut();
        window.location.href = '/';
        return;
      }

      initialized = true;
      const userEmail = document.getElementById('user-email');
      if (userEmail) userEmail.textContent = profile.fullName || user.email;
      initializeDashboard();
    } catch (error) {
      showToast(`Không thể kiểm tra tài khoản: ${error.message}`, 'error');
    }
  });
});

async function initializeDashboard() {
  try {
    await initializeChart();
  } catch (error) {
    console.error(`Không thể khởi tạo biểu đồ: ${error.message}`);
  }
  initializeControls();
  await Promise.allSettled([refreshLiveData(), refreshHistory(100), refreshAlerts()]);
  window.setInterval(refreshLiveData, LIVE_POLL_INTERVAL_MS);
  window.setInterval(() => refreshHistory(getSelectedHistoryLimit()), HISTORY_POLL_INTERVAL_MS);
  window.setInterval(refreshAlerts, LIVE_POLL_INTERVAL_MS);
}

async function refreshLiveData() {
  if (polling) return;
  polling = true;

  try {
    const [latestResult, statusResult] = await Promise.allSettled([
      getGasLatest(),
      getDeviceStatus(),
    ]);

    if (latestResult.status === 'fulfilled') {
      updateGasDisplay(latestResult.value.data);
    } else if (latestResult.reason.status !== 404) {
      throw latestResult.reason;
    }

    if (statusResult.status === 'fulfilled') {
      updateDeviceStatus(statusResult.value.data);
    } else {
      throw statusResult.reason;
    }

    updateServerConnection(true);
  } catch (error) {
    handleApiError(error);
    updateServerConnection(false);
  } finally {
    polling = false;
  }
}

async function refreshHistory(limit) {
  if (!gasChart) return;

  try {
    const response = await getGasHistory(limit);
    const points = response.data.map((reading) => ({
      x: Number(reading.timestamp) + VIETNAM_UTC_OFFSET_MS,
      y: reading.gasRaw,
    }));
    gasChart.updateSeries([{ name: 'Nồng độ Gas (ADC)', data: points }], false);
  } catch (error) {
    handleApiError(error, false);
  }
}

async function refreshAlerts() {
  try {
    const response = await getAlerts(10);
    if (response.data.length === 0) return;

    const latest = response.data[response.data.length - 1];
    if (latest.id === latestAlertId) return;
    latestAlertId = latest.id;

    if (latest.state === 'ALERT') {
      showAlertBanner(`CẢNH BÁO: mức gas ${latest.gasRaw} ADC. Hãy kiểm tra ngay.`);
    } else {
      hideAlertBanner();
    }
  } catch (error) {
    handleApiError(error, false);
  }
}

function updateGasDisplay(data) {
  const value = Number(data.gasRaw);
  const valueElement = document.getElementById('gas-value');
  const currentElement = document.getElementById('threshold-current');
  const fillElement = document.getElementById('threshold-fill');
  const readyElement = document.getElementById('sensor-ready');

  if (valueElement) {
    valueElement.textContent = Number.isFinite(value) ? Math.round(value) : '--';
    valueElement.classList.toggle('danger', Boolean(data.ready && data.alert));
  }
  if (currentElement) currentElement.textContent = Number.isFinite(value) ? Math.round(value) : '--';
  if (fillElement && Number.isFinite(value)) {
    fillElement.style.width = `${Math.min((value / ADC_MAX) * 100, 100)}%`;
    fillElement.classList.toggle('danger', Boolean(data.ready && data.alert));
  }
  if (readyElement) {
    readyElement.textContent = data.ready ? 'SẴN SÀNG' : 'ĐANG LÀM NÓNG';
    readyElement.style.color = data.ready ? 'var(--accent)' : 'var(--warning)';
  }
}

function updateDeviceStatus(data) {
  const live = data.mqtt || {};
  const availability = live.availability || data.availability || 'UNKNOWN';
  const buzzerState = live.buzzerState || data.buzzerState || 'UNKNOWN';
  const buzzerReason = live.buzzerReason || data.buzzerReason || 'UNKNOWN';
  const mqttConnected = Boolean(live.brokerConnected);

  setText('device-availability', availability);
  setText('mqtt-broker-status', mqttConnected ? 'CONNECTED' : 'DISCONNECTED');
  setText('gas-state', data.gasState || 'UNKNOWN');
  setText('buzzer-reason', buzzerReason);

  const availabilityElement = document.getElementById('device-availability');
  if (availabilityElement) {
    availabilityElement.style.color = availability === 'ONLINE' ? 'var(--accent)' : 'var(--danger)';
  }

  lastBuzzerState = buzzerState;
  const toggle = document.getElementById('buzzer-toggle');
  const stateElement = document.getElementById('buzzer-status-text');
  if (toggle) {
    toggle.checked = buzzerState === 'ON';
    toggle.disabled = availability !== 'ONLINE' || !mqttConnected || buzzerState === 'UNKNOWN';
  }
  if (stateElement) {
    stateElement.textContent = buzzerState === 'UNKNOWN' ? 'CHƯA XÁC ĐỊNH' : `ĐANG ${buzzerState === 'ON' ? 'BẬT' : 'TẮT'}`;
    stateElement.style.color = buzzerState === 'ON' ? 'var(--danger)' : 'var(--text-muted)';
  }
}

function initializeControls() {
  const toggle = document.getElementById('buzzer-toggle');
  toggle?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!['ON', 'OFF'].includes(lastBuzzerState)) return;

    const command = lastBuzzerState === 'ON' ? 'OFF' : 'ON';
    toggle.disabled = true;
    try {
      await publishBuzzerCommand(command);
      showToast(`Đã publish lệnh ${command}; đang chờ trạng thái thực tế từ ESP32.`, 'warning');
      window.setTimeout(refreshLiveData, 1000);
    } catch (error) {
      handleApiError(error);
    } finally {
      window.setTimeout(refreshLiveData, 1200);
    }
  });

  document.addEventListener('click', (event) => {
    const chip = event.target.closest('.btn-chip');
    if (!chip) return;
    document.querySelectorAll('.btn-chip').forEach((item) => item.classList.remove('active'));
    chip.classList.add('active');
    refreshHistory(Number.parseInt(chip.dataset.limit, 10) || 100);
  });

  document.querySelector('.alert-close')?.addEventListener('click', hideAlertBanner);
}

async function initializeChart() {
  const chartElement = document.getElementById('gas-chart');
  if (!chartElement) return;

  gasChart = new ApexCharts(chartElement, {
    chart: {
      type: 'line',
      height: 320,
      animations: { enabled: false },
      toolbar: { show: false },
      foreColor: '#94a3b8',
      background: 'transparent',
    },
    series: [{ name: 'Nồng độ Gas (ADC)', data: [] }],
    stroke: { curve: 'smooth', width: 2 },
    colors: ['#00ff88'],
    xaxis: {
      type: 'datetime',
      labels: { datetimeUTC: true },
      title: { text: 'Giờ Việt Nam (UTC+7)' },
    },
    yaxis: { min: 0, max: ADC_MAX, tickAmount: 8 },
    grid: { borderColor: 'rgba(255, 255, 255, 0.1)' },
    tooltip: {
      x: { format: 'dd/MM/yyyy HH:mm:ss' },
    },
    annotations: {
      yaxis: [{
        y: GAS_ALERT_THRESHOLD,
        borderColor: '#ff4444',
        label: { text: 'Ngưỡng cảnh báo 2500', style: { background: '#ff4444' } },
      }],
    },
    noData: { text: 'Chưa có dữ liệu lịch sử' },
  });
  await gasChart.render();
}

function getSelectedHistoryLimit() {
  const selected = document.querySelector('.btn-chip.active');
  return selected ? Number.parseInt(selected.dataset.limit, 10) || 100 : 100;
}

function updateServerConnection(connected) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (dot) dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  if (text) text.textContent = connected ? 'Server đã kết nối' : 'Mất kết nối server';
}

function showAlertBanner(message) {
  const banner = document.getElementById('alert-banner');
  const text = document.getElementById('alert-text');
  if (text) text.textContent = message;
  if (banner) banner.classList.add('active');
}

function hideAlertBanner() {
  document.getElementById('alert-banner')?.classList.remove('active');
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function handleApiError(error, notify = true) {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    if (notify) showToast(error.message, 'error');
    window.setTimeout(async () => {
      await auth.signOut();
      window.location.href = '/';
    }, 1000);
    return;
  }
  if (notify) showToast(error.message || 'Không thể kết nối server.', 'error');
}

function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  window.setTimeout(() => toast.remove(), 5000);
}
