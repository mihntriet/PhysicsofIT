// ============================================================
// API Client Module
// ============================================================
// Wrapper gọi REST API đến Back-end.
// Tự động attach Firebase Auth token vào header.
// ============================================================

const API_BASE = ''; // Same origin - không cần base URL

/**
 * Gọi API với Firebase Auth token.
 * @param {string} endpoint - VD: '/api/control/buzzer'
 * @param {object} options - fetch options
 * @returns {Promise<object>} Response JSON
 */
async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Attach Firebase Auth token nếu user đã đăng nhập
  try {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch (err) {
    console.warn('Could not get auth token:', err);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// ── Device Control ──

/**
 * Điều khiển Buzzer (còi).
 * @param {'ON'|'OFF'} state
 */
async function controlBuzzer(state) {
  return apiRequest('/api/control/buzzer', {
    method: 'POST',
    body: JSON.stringify({ state }),
  });
}

/**
 * Điều khiển LED (đèn).
 * @param {'ON'|'OFF'} state
 */
async function controlLed(state) {
  return apiRequest('/api/control/led', {
    method: 'POST',
    body: JSON.stringify({ state }),
  });
}

// ── Sensor Data ──

/**
 * Lấy giá trị cảm biến hiện tại.
 */
async function getSensorCurrent() {
  return apiRequest('/api/sensor/current');
}

/**
 * Lấy lịch sử dữ liệu cảm biến.
 * @param {number} limit - Số records (mặc định 50)
 */
async function getSensorHistory(limit = 50) {
  return apiRequest(`/api/sensor/history?limit=${limit}`);
}
