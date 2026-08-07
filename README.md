# 🏭 Gas Leak Monitor - Tài liệu Bàn giao Dự án

Dự án Web Quản lý Giám sát và Cảnh báo Rò rỉ Khí Gas (Node.js + Express + MQTT + Socket.io + ESP32 Captive Portal).

---

## 📌 BÁO CÁO CÁC NHIỆM VỤ ĐÃ HOÀN THÀNH (Triết thực hiện)

| Mã NV | Tên nhiệm vụ | Trạng thái | Thư mục / File tương ứng |
|-------|--------------|------------|---------------------------|
| **nc10** | Dựng khung Web Server Node.js + Express | ✅ Hoàn thành | `server/server.js`, `routes/api.js` |
| **nc12** | Cấu hình WiFi Captive Portal (192.168.4.1) trên ESP32 | ✅ Hoàn thành | `esp/esp32_wifi_config/esp32_wifi_config.ino` |
| **nc3**  | Đèn LED RGB báo trạng thái kết nối phần cứng | ✅ Hoàn thành | `esp32_wifi_config.ino` (Đỏ: AP, Xanh dương: Connect, Xanh lá: OK) |
| **cb2**  | ĐIỀU KHIỂN CÒI BUZZER QUA MQTT (IoT Single Source of Truth) | ✅ Hoàn thành | `server/services/mqttService.js`, `routes/api.js`, `client/js/dashboard.js` |

---

## 📡 SƠ ĐỒ KẾT NỐI MQTT TOPICS (broker.hivemq.com:1883)

| Topic | Phân loại | Hướng truyền | Payload / Message mẫu | Mô tả chức năng |
|-------|-----------|--------------|-----------------------|-----------------|
| `gas/sensor/data` | Sensor Data | ESP32 ➔ Server | `{"gas_level": 1250}` | ESP32 gửi nồng độ Gas ADC định kỳ mỗi 2s |
| `gas/control/buzzer` | Control Command | Server ➔ ESP32 | `"ON"` hoặc `"OFF"` | Web/Server phát lệnh bật/tắt còi Buzzer |
| `gas/status/buzzer` | Hardware Confirm | ESP32 ➔ Server | `"ON"` hoặc `"OFF"` | ESP32 xác nhận còi đã BẬT/TẮT thật sự để đổi UI trên Web |
| `gas/control/reset_wifi` | System Command | Server ➔ ESP32 | `{"command": "reset_wifi"}` | Lệnh yêu cầu ESP32 xóa Flash WiFi và `ESP.restart()` |

---

## 📝 DANH SÁCH REST API ENDPOINTS

| Method | Endpoint | Payload Body | Mô tả |
|--------|----------|--------------|-------|
| `POST` | `/api/control/buzzer` | `{"state": "ON"}` | Gửi lệnh Bật/Tắt còi Buzzer qua MQTT (Chức năng cb2) |
| `GET`  | `/api/gas-history` | `?limit=20` | Truy xuất 20 mốc lịch sử dữ liệu Gas từ Firebase |
| `POST` | `/api/control/wifi-reset` | `{"command": "reset_wifi"}` | Phát lệnh ngắt mạng và đưa ESP32 về chế độ AP 192.168.4.1 |

---

## 🛠️ NHIỆM VỤ TIẾP THEO DÀNH CHO HIẾU (TODO List)

1. **Cấu hình Firebase Credentials (Chức năng Firebase Auth & Realtime DB):**
   - Tải file `serviceAccountKey.json` từ Firebase Console -> Đặt vào thư mục `server/config/serviceAccountKey.json`.
   - Cập nhật thông tin Web App Config vào `client/js/firebase-config.js`.
   - Mở file `client/js/dashboard.js`, bỏ comment dòng check Auth `auth.onAuthStateChanged(...)` ở đầu file.
2. **Vẽ biểu đồ Chart.js lịch sử:**
   - Hoàn thiện việc render mảng lịch sử từ API `/api/gas-history` đắp vào Chart.js trong `dashboard.js`.


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
