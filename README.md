# 🌡️ ESP32 Gas Monitor – Multi-Product IoT System

Real-time gas monitoring system using ESP32, MQTT (HiveMQ Cloud), Firebase, and Pushsafer notifications.

## Architecture

```
PRODUCT CODE = DEVICE ID (e.g. H4N7K2)
        ↓
   ESP32 → MQTT (HiveMQ Cloud)
        ↓
   Node.js Server
        ↓
   Firebase (RTDB + Firestore) ← Web Dashboard
        ↓
   Pushsafer Notifications
```

**One product, one ID** — the 6-character product code (`H4N7K2`) is used as the MQTT device ID, Firebase path key, and device identifier across the entire system.

## MQTT Topics

All topics follow the pattern `devices/{productCode}/...`:

| Direction | Topic | Payload | QoS | Retain |
|-----------|-------|---------|-----|--------|
| ESP→Server | `devices/{id}/gas/data` | JSON `{deviceId, gasRaw, alert, ready, ...}` | 1 | No |
| ESP→Server | `devices/{id}/status/buzzer` | JSON `{state, reason}` | 1 | Yes |
| ESP→Server | `devices/{id}/status/led` | `ON` / `OFF` | 1 | Yes |
| ESP→Server | `devices/{id}/status/availability` | `ONLINE` / `OFFLINE` | 1 | Yes (LWT) |
| Server→ESP | `devices/{id}/control/buzzer` | `ON` / `OFF` | 1 | No |
| Server→ESP | `devices/{id}/control/led` | `ON` / `OFF` | 1 | No |
| Server→ESP | `devices/{id}/control/wifi-config` | `START` | 1 | No |

The Node.js server subscribes to **wildcard topics** (`devices/+/...`) and extracts the device ID from the topic path.

## Firebase Structure

### Firestore
```
products/{productCode}
  ├── name: string
  └── enabled: boolean

users/{uid}
  ├── email: string
  ├── productCode: string
  ├── pushsaferDeviceIds: string[]  (optional)
  └── createdAt: timestamp
```

### Realtime Database
```
devices/{productCode}/
  ├── latest/          (last gas reading)
  ├── readings/        (timestamped history)
  ├── alerts/          (state transitions)
  └── status/          (device state: buzzer, LED, availability)
```

## Registration & Authentication

1. User enters **email**, **password**, and **product code** (6 chars)
2. Product code is validated against `products/{code}` in Firestore
3. Firebase Auth account is created
4. User profile is saved to `users/{uid}` with `productCode`
5. All API requests use Firebase ID token + `productCode` for authorization

## Push Notifications (Pushsafer)

When a gas SAFE→ALERT transition occurs:
1. Find all `users` with `productCode === deviceId`
2. Collect all `pushsaferDeviceIds` from those users
3. Send a single Pushsafer request with pipe-separated device IDs

### Pairing a Phone

1. User clicks **"+ Thêm thiết bị"** in the dashboard
2. Server generates a 6-char pair code and returns the Guest ID
3. User installs Pushsafer app, registers as Guest with the given Guest ID
4. User sets their device name to the pair code
5. User clicks **"Xác nhận"** — server calls Pushsafer API to find the matching device
6. Device ID is saved to `users/{uid}.pushsaferDeviceIds`

## API Endpoints

### Public
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health check |
| POST | `/api/product/validate` | Validate a product code |

### Protected (Firebase ID Token required)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/gas/latest` | Latest gas reading |
| GET | `/api/gas/history?limit=100` | Historical readings |
| GET | `/api/alerts?limit=50` | Alert transitions |
| GET | `/api/device/status` | Device + MQTT status |
| POST | `/api/buzzer` | Send buzzer command |
| POST | `/api/led` | Send LED command |
| POST | `/api/device/wifi-config` | Trigger Wi-Fi config mode |
| POST | `/api/pushsafer/pair/start` | Start pairing flow |
| POST | `/api/pushsafer/pair/confirm` | Confirm pairing |

## Configuration

### Server `.env`
```env
HOST=0.0.0.0
PORT=3000

MQTT_BROKER_URL=mqtts://YOUR_CLUSTER.s1.eu.hivemq.cloud:8883
MQTT_USERNAME=
MQTT_PASSWORD=

FIREBASE_SERVICE_ACCOUNT_PATH=./config/serviceAccountKey.json
FIREBASE_DATABASE_URL=

PUSHSAFER_PRIVATE_KEY=
PUSHSAFER_USER=
PUSHSAFER_GUEST_ID=
```

### Firmware
Set `DEVICE_ID` in `esp/room_monitor.ino` to match the product code.

## Running

```bash
# Server
cd server
npm install
node server.js

# Firmware
# Open esp/room_monitor.ino in Arduino IDE
# Set Wi-Fi and MQTT credentials
# Upload to ESP32
```

## Hardware

- ESP32 DevKit V1
- MQ-2 Gas Sensor (analog)
- DHT11 Temperature/Humidity Sensor
- Active Buzzer
- RGB LED (Common Cathode)
