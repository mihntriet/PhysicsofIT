class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function apiRequest(endpoint, options = {}) {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError('Bạn chưa đăng nhập.', 401, null);
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
      response.status,
      payload
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

function publishBuzzerCommand(command) {
  return apiRequest('/api/buzzer', {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}
