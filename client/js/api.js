class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiRequest(endpoint, options = {}) {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError('Bạn chưa đăng nhập.', 401);
  }

  const token = await user.getIdToken();
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(
      payload && payload.error ? payload.error : `HTTP ${response.status}`,
      response.status
    );
  }

  return payload;
}

function getGasLatest() {
  return apiRequest('/api/gas/latest');
}

function getGasHistory(limit = 100) {
  return apiRequest(`/api/gas/history?limit=${encodeURIComponent(limit)}`);
}

function getAlerts(limit = 50) {
  return apiRequest(`/api/alerts?limit=${encodeURIComponent(limit)}`);
}

function getDeviceStatus() {
  return apiRequest('/api/device/status');
}

function requestWifiConfig() {
  return apiRequest('/api/device/wifi-config', { method: 'POST' });
}

function publishBuzzerCommand(command) {
  return apiRequest('/api/buzzer', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}

function publishLedCommand(command) {
  return apiRequest('/api/led', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}

function validateProductCode(code) {
  return fetch('/api/product/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productCode: code }),
  }).then((r) => r.json());
}

function startPairing() {
  return apiRequest('/api/pushsafer/pair/start', { method: 'POST' });
}

function confirmPairing(code) {
  return apiRequest('/api/pushsafer/pair/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}
