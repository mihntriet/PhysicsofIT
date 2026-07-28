# 🏭 Gas Leak Monitor - Hệ thống Giám sát & Cảnh báo Rò rỉ Khí Gas

Hệ thống web giám sát nồng độ khí gas real-time, điều khiển thiết bị (Buzzer/LED) từ xa, và cảnh báo khẩn cấp khi nồng độ vượt ngưỡng.

## 📐 Kiến trúc hệ thống

```
ESP32 + MQ-2 ──MQTT──► Node.js Server ──Socket.io──► Browser (Dashboard)
                              │                            │
                              ▼                            ▼
                      Firebase Realtime DB         Chart.js + Real-time UI
                              │
                              ▼
                    Push Notification (giả lập)
```

## 🛠️ Tech Stack

| Layer | Công nghệ |
|-------|-----------|
| Back-end | Node.js, Express.js, Socket.io |
| MQTT | mqtt.js (kết nối ESP32) |
| Front-end | HTML/CSS/JS thuần, Chart.js |
| Auth | Firebase Authentication |
| Database | Firebase Realtime Database |

## 📁 Cấu trúc thư mục

```
gas-leak-monitor/
├── server/
│   ├── server.js              # Entry point
│   ├── config/firebase.js     # Firebase Admin SDK
│   ├── services/
│   │   ├── mqttService.js     # MQTT subscribe/publish
│   │   ├── firebaseService.js # Đọc/ghi Firebase DB
│   │   └── alertService.js    # Cảnh báo vượt ngưỡng
│   └── routes/api.js          # REST API endpoints
├── client/
│   ├── index.html             # Trang Login/Register
│   ├── dashboard.html         # Trang Dashboard
│   ├── css/style.css          # Stylesheet
│   └── js/
│       ├── firebase-config.js # Firebase client config
│       ├── auth.js            # Login/Register logic
│       ├── api.js             # REST API wrapper
│       └── dashboard.js       # Dashboard logic
└── README.md
```

## 🚀 Hướng dẫn cài đặt

### 1. Clone & Install dependencies

```bash
cd server
npm install
```

### 2. Tạo Firebase Project

1. Vào [Firebase Console](https://console.firebase.google.com/)
2. Tạo project mới
3. Bật **Authentication** → Email/Password
4. Bật **Realtime Database** → Start in test mode
5. Tải **Service Account Key**:
   - Project Settings → Service Accounts → Generate New Private Key
   - Lưu file JSON vào `server/config/serviceAccountKey.json`
6. Copy **Web App Config**:
   - Project Settings → General → Your apps → Add web app
   - Copy config vào `client/js/firebase-config.js`

### 3. Cấu hình Environment

```bash
cd server
copy .env.example .env
```

Sửa file `.env`:
```
FIREBASE_DATABASE_URL=https://physics-of-it-default-rtdb.asia-southeast1.firebasedatabase.app
MQTT_BROKER_URL=mqtt://broker.hivemq.com
GAS_THRESHOLD=2000
```

### 4. Chạy Server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Mở trình duyệt: **http://localhost:3000**

## 📡 MQTT Topics (cho ESP32)

| Topic | Hướng | Payload | Mô tả |
|-------|-------|---------|-------|
| `gas/sensor/data` | ESP32 → Server | `{"value": 1234}` hoặc `1234` | Giá trị ADC cảm biến |
| `gas/control/buzzer` | Server → ESP32 | `"ON"` / `"OFF"` | Điều khiển còi |
| `gas/control/led` | Server → ESP32 | `"ON"` / `"OFF"` | Điều khiển LED |

### Ví dụ code ESP32 (Arduino)

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

const char* mqtt_server = "broker.hivemq.com";
const char* topic_gas = "gas/sensor/data";
const char* topic_buzzer = "gas/control/buzzer";
const char* topic_led = "gas/control/led";

void callback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (int i = 0; i < length; i++) msg += (char)payload[i];
  
  if (String(topic) == topic_buzzer) {
    digitalWrite(BUZZER_PIN, msg == "ON" ? HIGH : LOW);
  }
  if (String(topic) == topic_led) {
    digitalWrite(LED_PIN, msg == "ON" ? HIGH : LOW);
  }
}

void loop() {
  int gasValue = analogRead(GAS_PIN);
  String payload = "{\"value\":" + String(gasValue) + "}";
  client.publish(topic_gas, payload.c_str());
  delay(2000);
}
```

## 🧪 Test nhanh (không cần ESP32)

Dùng MQTT client (MQTT Explorer, mosquitto_pub) để gửi dữ liệu test:

```bash
# Gửi giá trị gas giả lập
mosquitto_pub -h broker.hivemq.com -t "gas/sensor/data" -m '{"value": 1500}'

# Test cảnh báo (vượt ngưỡng 2000)
mosquitto_pub -h broker.hivemq.com -t "gas/sensor/data" -m '{"value": 3000}'
```

## 📝 API Endpoints

| Method | Endpoint | Body | Mô tả |
|--------|----------|------|-------|
| `POST` | `/api/control/buzzer` | `{"state":"ON"}` | Bật/tắt còi |
| `POST` | `/api/control/led` | `{"state":"ON"}` | Bật/tắt LED |
| `GET` | `/api/sensor/current` | - | Giá trị gas hiện tại |
| `GET` | `/api/sensor/history?limit=50` | - | Lịch sử dữ liệu |

## 📄 License

MIT
