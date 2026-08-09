# Gas Leak Monitor – bản final

Hệ thống giám sát rò rỉ khí gas dùng ESP32, Mosquitto cục bộ, Node.js, Firebase và Pushsafer. Repository chỉ có một kiến trúc và một firmware production.

## 1. Kiến trúc

```text
ESP32 room_monitor.ino
        │ MQTT username/password
        ▼
Mosquitto trên laptop :1883
        ▲
        │ MQTT.js (mqtt://LAPTOP-C1259HLI:1883)
        ▼
Node.js / Express :3000
        ├── Firebase Realtime Database: telemetry, trạng thái, cảnh báo
        ├── Cloud Firestore: hồ sơ tài khoản
        ├── Firebase Admin: verify ID token
        ├── Pushsafer: cảnh báo điện thoại
        └── REST API polling 5 giây
                    │
                    ▼
               Web dashboard
```

`mqtt` trong Node.js là MQTT client. Broker duy nhất là một process Mosquitto trên laptop. Không dùng HiveMQ public, Socket.IO hoặc broker thứ hai.

## 2. Cấu trúc repository

```text
PhysicsofIT/
├── client/
│   ├── css/style.css
│   ├── js/
│   │   ├── api.js
│   │   ├── auth.js
│   │   ├── dashboard.js
│   │   └── firebase-config.js
│   ├── dashboard.html
│   └── index.html
├── esp/
│   └── room_monitor.ino       # firmware production duy nhất
├── mosquitto/
│   └── mosquitto.conf.example
├── server/
│   ├── config/firebase.js
│   ├── routes/api.js
│   ├── services/
│   │   ├── alertService.js
│   │   ├── firebaseService.js
│   │   └── mqttService.js
│   ├── .env.example
│   ├── package.json
│   └── server.js
├── database.rules.json
├── firebase.json
├── firestore.rules
└── README.md
```

## 3. Phần cứng và GPIO

| Thiết bị | GPIO |
|---|---:|
| MQ-2 analog | 34 |
| Buzzer | 26 |
| RGB Red | 25 |
| RGB Green | 32 |
| RGB Blue | 33 |
| DHT11 | 27 |
| LCD I2C SDA | 13 |
| LCD I2C SCL | 14 |
| Nút BOOT cấu hình lại | 0 |

Chỉ nạp `esp/room_monitor.ino`. Không đổi GPIO nếu chưa đổi dây thật.

Các thư viện Arduino cần có:

- PubSubClient
- DHT sensor library
- LiquidCrystal I2C
- ESP32 board package (`WiFi`, `WebServer`, `DNSServer`, `Preferences` đi kèm)

## 4. Logic an toàn trên ESP32

- MQ-2 warm-up 180.000 ms. Trong thời gian này `ready=false`, không tạo cảnh báo.
- `gasRaw >= 2500`: chuyển sang `ALERT`.
- Đang `ALERT` và `gasRaw <= 2200`: chuyển về `SAFE`.
- ESP32, không phải server, quyết định ALERT/SAFE.
- Buzzer thực tế: `gasAlert || remoteBuzzer`. Lệnh remote OFF không thể tắt cảnh báo gas.
- RGB đỏ: gas alert; xanh: Wi-Fi và MQTT hoạt động; vàng: mất Wi-Fi hoặc MQTT.
- DHT11 chỉ hiển thị trên LCD, không lưu Firebase.

MQ-2 trong dự án trả ADC thô, không phải ppm đã hiệu chuẩn và không thay thế thiết bị báo gas đạt chuẩn an toàn.

## 5. MQTT contract

`DEVICE_ID=ESP32-GAS-MONITOR`.

| Topic | Hướng | Nội dung |
|---|---|---|
| `devices/ESP32-GAS-MONITOR/gas/data` | ESP → server | telemetry |
| `devices/ESP32-GAS-MONITOR/gas/alert` | ESP → server | chuyển ALERT/SAFE, retained |
| `devices/ESP32-GAS-MONITOR/control/buzzer` | server → ESP | `ON` hoặc `OFF` |
| `devices/ESP32-GAS-MONITOR/status/buzzer` | ESP → server | trạng thái thực, retained |
| `devices/ESP32-GAS-MONITOR/status/availability` | ESP → server | `ONLINE`/`OFFLINE`, retained |

Gas data:

```json
{"deviceId":"ESP32-GAS-MONITOR","gasRaw":1234,"alert":false,"ready":true}
```

Gas alert:

```json
{"deviceId":"ESP32-GAS-MONITOR","gasRaw":2800,"state":"ALERT"}
```

Buzzer status:

```json
{"state":"ON","reason":"GAS_ALARM"}
```

`reason` là `GAS_ALARM`, `REMOTE` hoặc `NONE`. Trạng thái chưa nhận được là `UNKNOWN`, không giả định là OFF.

ESP đăng ký Last Will retained `OFFLINE` trên topic availability. Khi kết nối thành công ESP publish retained `ONLINE`.

## 6. Cài Mosquitto trên Windows

1. Cài Mosquitto từ trang chính thức và xác định thư mục có `mosquitto.exe`, `mosquitto_pub.exe`, `mosquitto_sub.exe`, `mosquitto_passwd.exe`.
2. Tạo thư mục cấu hình, ví dụ `C:\mosquitto\config`.
3. Copy `mosquitto/mosquitto.conf.example` thành `C:\mosquitto\config\mosquitto.conf` và sửa đường dẫn nếu cần.
4. Tạo password file, không đặt file thật vào Git:

```powershell
mosquitto_passwd -c C:\mosquitto\config\password_file gasmonitor
```

Config bắt buộc phải có:

```conf
listener 1883
allow_anonymous false
password_file C:/mosquitto/config/password_file
```

Chạy foreground để dễ xem log:

```powershell
mosquitto -c C:\mosquitto\config\mosquitto.conf -v
```

Không đồng thời chạy Windows service và một process foreground khác.

### Kiểm tra trùng Mosquitto instance

```powershell
netstat -ano | findstr :1883
tasklist /FI "PID eq <PID_TIM_DUOC>"
```

Chỉ một PID được listen trên TCP 1883. Node và ESP đều dùng broker đã cấu hình và phải kết nối đúng process này.

### Windows Firewall

Chỉ mở trên mạng Private/trusted LAN:

- TCP 1883: ESP → Mosquitto.
- TCP 3000: trình duyệt/thiết bị khác → Express.

Có thể tạo inbound rules trong Windows Defender Firewall → Advanced settings → Inbound Rules. Không mở các port này trực tiếp ra Internet.

## 7. Cài và chạy Node.js

Yêu cầu Node.js 22 trở lên (Firebase Admin 14 yêu cầu runtime này).

```powershell
cd server
copy .env.example .env
npm install
npm start
```

Server mặc định listen `0.0.0.0:3000`. Trong môi trường hiện tại, Node dùng `MQTT_BROKER_URL=mqtt://LAPTOP-C1259HLI:1883` để kết nối đúng broker LAN mà ESP đang sử dụng.

Server khởi tạo theo thứ tự: dotenv → Firebase Admin → Express → REST/static client → MQTT → HTTP listen. `Ctrl+C` thực hiện graceful shutdown MQTT, HTTP và Firebase.

Package production của server:

- `express`: HTTP/static/REST.
- `dotenv`: cấu hình local.
- `mqtt`: MQTT client kết nối Mosquitto.
- `firebase-admin`: Auth token, Firestore và Realtime Database.
- `pushsafer-notifications`: cảnh báo điện thoại.

`nodemon` chỉ là dev dependency. Không còn `cors` hoặc `socket.io`.

## 8. Captive Portal và đổi mạng

ESP đọc MQTT broker đã lưu trong Preferences và kết nối trực tiếp tới host/port đó. Không có cơ chế tự động tìm broker khác.

Luồng kết nối của ESP:

1. Kết nối Wi-Fi đã lưu.
2. Dùng MQTT broker host/port đã lưu trong Preferences.
3. Nếu MQTT chưa kết nối được, tiếp tục retry theo timer 5 giây.
4. Nếu chưa có cấu hình hoặc Wi-Fi lỗi kéo dài: mở Captive Portal.

Captive Portal tạo AP dạng `Gas_Monitor_XXXXXX`. Password setup dạng `GAS-XXXXXX` được in trong Serial Monitor. Kết nối AP rồi mở `http://192.168.4.1` để nhập:

- Wi-Fi SSID/password.
- MQTT broker host/port.
- MQTT username/password.

Các giá trị được lưu trong Preferences/NVS, không nằm trong firmware. Khi đổi mạng không sửa code hoặc nạp lại firmware. Nếu ESP vẫn kết nối mạng cũ nhưng cần cấu hình lại, giữ nút BOOT khoảng 5 giây; ESP xóa cấu hình và khởi động Captive Portal.

Broker có thể là hostname như `LAPTOP-C1259HLI`. Nếu ESP không resolve được hostname trên mạng hiện tại, nhập IPv4 hiện tại của laptop qua portal. Đây là cấu hình runtime, không hard-code trong firmware.

## 9. Firebase Realtime Database

Realtime Database chỉ lưu telemetry/device qua Firebase Admin:

```text
devices/ESP32-GAS-MONITOR/
├── latest/{deviceId,gasRaw,alert,ready,timestamp}
├── readings/{pushId}/{deviceId,gasRaw,alert,timestamp}
├── alerts/{pushId}/{deviceId,gasRaw,state,previousState,timestamp}
└── status/{gasState,gasRaw,buzzerState,buzzerReason,availability,updatedAt}
```

`latest` cập nhật mỗi payload hợp lệ. `ready=false` không được đưa vào readings. History mặc định lưu 30 giây/lần và lưu sớm khi `alert` đổi để giảm số bản ghi.

Browser không đọc/ghi Realtime Database trực tiếp. `database.rules.json` từ chối toàn bộ client; Firebase Admin trên server bypass rules.

## 10. Firebase Authentication và Firestore

Authentication sử dụng Email/Password. Firestore collection `users`, document ID bằng Auth UID:

```json
{
  "uid": "firebase-auth-uid",
  "fullName": "Nguyễn Văn A",
  "email": "user@example.com",
  "role": "user",
  "status": "pending",
  "createdAt": "Firebase server timestamp"
}
```

Không lưu password, password hash hoặc password mã hóa trong Firestore.

Luồng đăng ký:

1. Client tạo tài khoản Firebase Authentication.
2. Client tạo `users/{uid}` với `role=user`, `status=pending`.
3. Hiện thông báo đang chờ cấp quyền và đăng xuất.
4. Admin vào Firebase Console → Firestore Database → `users` → user tương ứng → đổi `status` từ `pending` thành `active`.

Không cần admin dashboard. Firestore rules chỉ cho user tạo/read hồ sơ của mình và chỉ cập nhật `fullName`; user không thể đổi `uid`, `role`, `status`, `createdAt`.

Khi login, client kiểm tra profile. Backend vẫn verify ID token và đọc lại profile Firestore cho từng API. Thiếu token trả 401; tài khoản pending/missing profile trả 403. Frontend không phải ranh giới bảo mật.

Quên mật khẩu dùng `sendPasswordResetEmail()` của Firebase Authentication và không sửa Firestore.

Deploy rules bằng Firebase CLI từ thư mục gốc:

```powershell
firebase login
firebase use <FIREBASE_PROJECT_ID>
firebase deploy --only firestore:rules,database
```

Hoặc paste `firestore.rules` và `database.rules.json` vào tab Rules tương ứng trong Firebase Console rồi Publish.

## 11. Pushsafer

Server gửi Pushsafer đúng một lần khi trạng thái lưu trong Firebase chuyển `SAFE → ALERT`. `ready=false`, ALERT lặp lại và trạng thái khởi tạo UNKNOWN không gửi notification. SAFE reset chu kỳ để lần ALERT kế tiếp được gửi.

Nếu chưa cấu hình Pushsafer, alert vẫn được lưu Firebase và server log rõ notification bị bỏ qua.

## 12. REST API

`GET /api/health` là public. Tất cả endpoint còn lại yêu cầu:

```http
Authorization: Bearer <Firebase ID Token>
```

| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| GET | `/api/health` | Public | Server/Firebase/MQTT health |
| GET | `/api/gas/latest` | Active user | Mẫu mới nhất |
| GET | `/api/gas/history?limit=100` | Active user | History tăng dần theo timestamp; limit 1–500 |
| GET | `/api/alerts?limit=50` | Active user | Chuyển trạng thái ALERT/SAFE |
| GET | `/api/device/status` | Active user | Availability, gas, buzzer, MQTT |
| POST | `/api/buzzer` | Active user | Publish `{"command":"ON"}` hoặc `{"command":"OFF"}` |

POST buzzer trả HTTP 202 khi lệnh đã publish. Trạng thái thật phải đọc từ `status/buzzer`; API không tự giả định còi đã đổi trạng thái.

Không có API reset config từ xa. Cấu hình lại bằng nút BOOT vật lý để tránh một request web làm thiết bị mất mạng ngoài ý muốn.

## 13. Dashboard

Dashboard giữ layout cũ nhưng dùng REST polling khoảng 5 giây, không dùng Socket.IO. Lịch sử cập nhật khoảng 30 giây, phù hợp chu kỳ lưu Firebase.

Biểu đồ dùng ApexCharts:

- X: `timestamp`.
- Timestamp được lưu dạng Unix milliseconds; biểu đồ luôn hiển thị theo giờ Việt Nam
  (`Asia/Ho_Chi_Minh`, UTC+7), không phụ thuộc múi giờ của trình duyệt.
- Y: `gasRaw`.
- Annotation ngưỡng: 2500.

Không có LED ON/OFF vì RGB là status LED an toàn.

## 14. Test MQTT bằng MQTT Explorer/CLI

Kết nối MQTT Explorer tới IPv4 laptop, port 1883 và credentials đã tạo. Subscribe `devices/ESP32-GAS-MONITOR/#`.

Test CLI trên laptop:

```powershell
mosquitto_sub -h localhost -p 1883 -u gasmonitor -P "<MQTT_PASSWORD>" -t "devices/ESP32-GAS-MONITOR/#" -v
```

Giả lập telemetry:

```powershell
mosquitto_pub -h localhost -p 1883 -u gasmonitor -P "<MQTT_PASSWORD>" -t "devices/ESP32-GAS-MONITOR/gas/data" -m '{"deviceId":"ESP32-GAS-MONITOR","gasRaw":1234,"alert":false,"ready":true}'
```

Giả lập SAFE rồi ALERT để test alert/Pushsafer:

```powershell
mosquitto_pub -h localhost -p 1883 -u gasmonitor -P "<MQTT_PASSWORD>" -t "devices/ESP32-GAS-MONITOR/gas/alert" -r -m '{"deviceId":"ESP32-GAS-MONITOR","gasRaw":1800,"state":"SAFE"}'
mosquitto_pub -h localhost -p 1883 -u gasmonitor -P "<MQTT_PASSWORD>" -t "devices/ESP32-GAS-MONITOR/gas/alert" -r -m '{"deviceId":"ESP32-GAS-MONITOR","gasRaw":2800,"state":"ALERT"}'
```

## 15. Test REST API

Health không cần token:

```powershell
curl.exe http://localhost:3000/api/health
```

Xác nhận API protected:

```powershell
curl.exe -i http://localhost:3000/api/gas/latest
```

Kết quả phải là HTTP 401. Với active user, lấy Firebase ID token từ phiên đăng nhập client rồi test:

```powershell
curl.exe -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" http://localhost:3000/api/gas/latest
curl.exe -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" http://localhost:3000/api/gas/history?limit=100
curl.exe -X POST -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" -H "Content-Type: application/json" -d '{"command":"ON"}' http://localhost:3000/api/buzzer
```

## 16. Thứ tự chạy và tắt

Chạy:

1. Kiểm tra port 1883 chưa bị process Mosquitto khác chiếm.
2. Chạy Mosquitto với config username/password.
3. Chạy Node trong `server/`.
4. Bật/reset ESP32; lần đầu cấu hình qua Captive Portal.
5. Mở `http://localhost:3000`, đăng nhập bằng user `active`.

Tắt:

1. Dừng thao tác dashboard.
2. Tắt ESP32 nếu cần.
3. Nhấn `Ctrl+C` tại Node để graceful shutdown.
4. Nhấn `Ctrl+C` tại Mosquitto foreground hoặc dừng Windows service tương ứng.

## 17. Người dùng cần tự điền / setup

### A. Firebase Web Config

Lấy ở đâu: Firebase Console → Project Settings → General → Your apps → Web App → SDK setup and configuration.

Lấy: `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.

Dán vào đâu: `client/js/firebase-config.js`, object `firebaseConfig`. Không đặt service account tại đây.

### B. Firebase Realtime Database URL

Lấy ở đâu: Firebase Console → Realtime Database → Data; copy URL database theo region.

Dán vào đâu: `server/.env`:

```env
FIREBASE_DATABASE_URL=https://<PROJECT>-default-rtdb.<REGION>.firebasedatabase.app
```

### C. Firebase Service Account

Lấy ở đâu: Firebase Console → Project Settings → Service Accounts → Firebase Admin SDK → Generate new private key.

Đặt file tại: `server/config/serviceAccountKey.json`.

Trong `server/.env`:

```env
FIREBASE_SERVICE_ACCOUNT_PATH=./config/serviceAccountKey.json
```

Không paste private key vào README, client hoặc Git.

### D. Firebase Authentication

Firebase Console → Authentication → Sign-in method → Email/Password → Enable.

Thêm domain truy cập dashboard vào Authentication → Settings → Authorized domains nếu truy cập bằng hostname/IP khác localhost.

### E. Cloud Firestore

Firebase Console → Firestore Database → Create database. Chọn region phù hợp, sau đó deploy/publish `firestore.rules`.

Admin duyệt user tại Firestore Database → Data → `users/{uid}` → đổi `status` thành `active`.

### F. Realtime Database Rules

Firebase Console → Realtime Database → Rules. Paste nội dung `database.rules.json` hoặc deploy bằng Firebase CLI. Rules cuối phải từ chối browser read/write trực tiếp.

### G. Pushsafer

Lấy Private Key và Device/Device Group ID từ Pushsafer Dashboard.

Dán vào `server/.env`:

```env
PUSHSAFER_PRIVATE_KEY=<PRIVATE_KEY>
PUSHSAFER_DEVICE_ID=<DEVICE_OR_GROUP_ID>
```

### H. Mosquitto credentials

Tạo bằng `mosquitto_passwd`, không tự ghi plaintext vào password file.

Dán cùng username/password vào `server/.env`:

```env
MQTT_USERNAME=gasmonitor
MQTT_PASSWORD=<MQTT_PASSWORD>
```

Nhập cùng credentials vào Captive Portal của ESP32. Không hard-code MQTT password trong firmware.

### I. MQTT broker cho ESP32

Không điền IPv4 laptop vào source code. Captive Portal yêu cầu broker host; ưu tiên `LAPTOP-C1259HLI`. Nếu ESP không resolve được hostname thì nhập IPv4 hiện tại của laptop. Khi đổi mạng, giữ BOOT 5 giây để cập nhật broker nếu cần, không phải nạp lại firmware.

## 18. Troubleshooting

### ESP không resolve được hostname broker

- Giữ BOOT 5 giây để mở Captive Portal.
- Nhập IPv4 hiện tại của laptop vào trường MQTT broker.
- Không cần sửa hoặc nạp lại firmware.

### ESP tìm thấy broker nhưng MQTT bị từ chối

- Kiểm tra `allow_anonymous false`, password file và credentials ở Node/ESP giống nhau.
- Xem log `mosquitto -v` và mã state in ở Serial Monitor.
- Mở TCP 1883 cho mạng Private.

### Node kết nối được nhưng ESP không kết nối

Kiểm tra Node và ESP đang dùng cùng broker host, port và credentials. Mosquitto phải listen trên interface LAN và Windows Firewall phải cho phép TCP 1883 từ mạng tin cậy.

### Dashboard trả 401/403

- 401: thiếu/hết hạn Firebase ID token hoặc Firebase Web config sai.
- 403: hồ sơ Firestore không tồn tại hoặc `status` chưa là `active`.

### Firebase không có history

- `latest` vẫn cập nhật mỗi message.
- `readings` chỉ ghi khi `ready=true`, khoảng 30 giây/lần hoặc khi trạng thái alert đổi.
- Lỗi Firebase được server/API báo 503, không giả thành mảng rỗng.

### Verify firmware

Mở `esp/room_monitor.ino` bằng Arduino IDE, chọn đúng ESP32 board/COM port, cài các thư viện nêu trên rồi bấm **Verify** trước khi Upload. Serial Monitor dùng 115200 baud.
