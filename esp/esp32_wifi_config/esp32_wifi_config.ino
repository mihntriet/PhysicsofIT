/*
 * ====================================================================
 * PROJECT: Gas Sensor & Alert System - ESP32 WiFi Provisioning + MQTT
 * AUTHOR:  Embedded Systems Engineer
 * BOARD:   ESP32 Dev Module (Arduino IDE)
 * ====================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <PubSubClient.h>

// ====================================================================
// CẤU HÌNH PHẦN CỨNG (HARDWARE CONFIGURATION)
// ====================================================================
#define LED_RED_PIN    25
#define LED_GREEN_PIN  26
#define LED_BLUE_PIN   27

#define MQ2_PIN        34   // Chân Analog đọc nồng độ Gas MQ-2
#define BUZZER_PIN     32   // Chân Digital điều khiển Còi Buzzer

#define IS_COMMON_ANODE false
#define WIFI_CONNECT_TIMEOUT_SEC 15

// ====================================================================
// CẤU HÌNH MQTT BROKER & TOPICS
// ====================================================================
const char* mqtt_server = "broker.hivemq.com";
const int   mqtt_port   = 1883;

const char* TOPIC_GAS_DATA       = "gas/sensor/data";
const char* TOPIC_CONTROL_BUZZER = "gas/control/buzzer";
const char* TOPIC_CONTROL_LED    = "gas/control/led";
const char* TOPIC_RESET_WIFI     = "gas/control/reset_wifi";

// ====================================================================
// KHAI BÁO BIẾN TOÀN CỤC
// ====================================================================
WebServer server(80);
DNSServer dnsServer;
Preferences preferences;

WiFiClient espClient;
PubSubClient mqttClient(espClient);

const byte DNS_PORT = 53;
IPAddress apIP(192, 168, 4, 1);
IPAddress netMsk(255, 255, 255, 0);

String ssid_saved = "";
String pass_saved = "";
bool isAPMode = false;

unsigned long lastMqttRetry = 0;
unsigned long lastSensorRead = 0;

// ====================================================================
// 1. QUẢN LÝ LED RGB
// ====================================================================
void setRGBColor(uint8_t red, uint8_t green, uint8_t blue) {
  if (IS_COMMON_ANODE) {
    red = 255 - red;
    green = 255 - green;
    blue = 255 - blue;
  }
  analogWrite(LED_RED_PIN, red);
  analogWrite(LED_GREEN_PIN, green);
  analogWrite(LED_BLUE_PIN, blue);
}

void setRGBRed()   { setRGBColor(255, 0, 0); }
void setRGBGreen() { setRGBColor(0, 255, 0); }
void setRGBBlue()  { setRGBColor(0, 0, 255); }
void setRGBOff()   { setRGBColor(0, 0, 0); }

// ====================================================================
// 2. MQTT CALLBACK & CONTROL LOGIC
// ====================================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  message.trim();

  Serial.print("📩 [MQTT Received] Topic [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(message);

  // 1. Điều khiển Còi Buzzer
  if (String(topic) == TOPIC_CONTROL_BUZZER) {
    if (message.equalsIgnoreCase("ON")) {
      digitalWrite(BUZZER_PIN, HIGH);
      Serial.println("  -> 🔔 Buzzer: BẬT");
    } else if (message.equalsIgnoreCase("OFF")) {
      digitalWrite(BUZZER_PIN, LOW);
      Serial.println("  -> 🔕 Buzzer: TẮT");
    }
  }

  // 2. Lệnh RESET WIFI từ Dashboard
  if (String(topic) == TOPIC_RESET_WIFI) {
    Serial.println("  -> ⚠️ Nhận lệnh Cấu hình lại mạng! Đang xóa Flash & Reset...");
    preferences.begin("wifi-config", false);
    preferences.clear();
    preferences.end();
    
    delay(1000);
    ESP.restart();
  }
}

void reconnectMQTT() {
  if (millis() - lastMqttRetry > 5000) {
    lastMqttRetry = millis();
    
    String clientId = "ESP32_GasSensor_" + String(random(0xffff), HEX);
    Serial.print("🔌 Đang kết nối tới MQTT Broker: ");
    Serial.print(mqtt_server);
    Serial.print("... ");

    if (mqttClient.connect(clientId.c_str())) {
      Serial.println("✅ THÀNH CÔNG!");
      mqttClient.subscribe(TOPIC_CONTROL_BUZZER);
      mqttClient.subscribe(TOPIC_CONTROL_LED);
      mqttClient.subscribe(TOPIC_RESET_WIFI);
    } else {
      Serial.print("❌ THẤT BẠI (rc=");
      Serial.print(mqttClient.state());
      Serial.println(")");
    }
  }
}

void readAndPublishGasData() {
  if (millis() - lastSensorRead >= 2000) {
    lastSensorRead = millis();

    int rawValue = analogRead(MQ2_PIN);
    String payload = "{\"gas_level\":" + String(rawValue) + "}";

    if (mqttClient.connected()) {
      mqttClient.publish(TOPIC_GAS_DATA, payload.c_str());
      Serial.print("📤 [MQTT Publish] ");
      Serial.print(TOPIC_GAS_DATA);
      Serial.print(" -> ");
      Serial.println(payload);
    }
  }
}

// ====================================================================
// 3. CAPTIVE PORTAL WEBPAGE TEMPLATE
// ====================================================================
String generateHTML(String optionsList, String statusMsg = "Đang chờ cấu hình") {
  String html = "<!DOCTYPE html><html lang='vi'><head>";
  html += "<meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'>";
  html += "<title>Cấu hình Wi-Fi Thiết bị</title>";
  html += "<style>";
  html += "body { font-family: 'Segoe UI', Roboto, sans-serif; background-color: #0a0e17; color: #e2e8f0; margin: 0; padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 100vh; }";
  html += ".card { background: rgba(17, 24, 39, 0.85); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 30px; width: 100%; max-width: 380px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }";
  html += "h2 { color: #00ff88; margin-bottom: 24px; font-size: 1.3rem; font-weight: 700; letter-spacing: 0.5px; }";
  html += ".form-group { margin-bottom: 18px; text-align: left; }";
  html += "label { display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 6px; font-weight: 600; text-transform: uppercase; }";
  html += "select, input[type='password'] { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: #1e293b; color: #fff; font-size: 0.95rem; box-sizing: border-box; outline: none; }";
  html += "select:focus, input:focus { border-color: #00ff88; }";
  html += ".btn-group { display: flex; gap: 10px; margin-top: 24px; }";
  html += ".btn { flex: 1; padding: 12px; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; transition: all 0.2s; font-size: 0.9rem; }";
  html += ".btn-scan { background: #3b82f6; color: #fff; }";
  html += ".btn-scan:hover { background: #2563eb; }";
  html += ".btn-connect { background: #00ff88; color: #0a0e17; }";
  html += ".btn-connect:hover { background: #00cc6a; }";
  html += ".status-info { margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.82rem; color: #94a3b8; text-align: left; line-height: 1.6; }";
  html += ".highlight { color: #00ff88; font-weight: 600; }";
  html += "</style></head><body>";
  
  html += "<div class='card'>";
  html += "<h2>CẤU HÌNH WI-FI THIẾT BỊ</h2>";
  html += "<form action='/save' method='POST'>";
  
  html += "<div class='form-group'>";
  html += "<label>Tên mạng Wi-Fi</label>";
  html += "<select name='ssid' required>";
  html += optionsList;
  html += "</select>";
  html += "</div>";
  
  html += "<div class='form-group'>";
  html += "<label>Mật khẩu</label>";
  html += "<input type='password' name='pass' placeholder='Nhập mật khẩu Wi-Fi' required>";
  html += "</div>";
  
  html += "<div class='btn-group'>";
  html += "<button type='button' class='btn btn-scan' onclick=\"location.href='/'\">QUÉT LẠI</button>";
  html += "<button type='submit' class='btn btn-connect'>KẾT NỐI</button>";
  html += "</div>";
  
  html += "</form>";
  
  html += "<div class='status-info'>";
  html += "<div>Trạng thái: <span class='highlight'>" + statusMsg + "</span></div>";
  html += "<div>Địa chỉ truy cập: <span class='highlight'>192.168.4.1</span></div>";
  html += "</div>";
  
  html += "</div></body></html>";
  
  return html;
}

String scanNetworks() {
  int n = WiFi.scanNetworks();
  String options = "";
  if (n == 0) {
    options = "<option value=''>Không tìm thấy mạng Wi-Fi</option>";
  } else {
    for (int i = 0; i < n; ++i) {
      String ssid = WiFi.SSID(i);
      int rssi = WiFi.RSSI(i);
      options += "<option value='" + ssid + "'>" + ssid + " (" + String(rssi) + " dBm)</option>";
    }
  }
  return options;
}

void handleRoot() {
  String options = scanNetworks();
  server.send(200, "text/html", generateHTML(options));
}

void handleSave() {
  if (server.hasArg("ssid") && server.hasArg("pass")) {
    String req_ssid = server.arg("ssid");
    String req_pass = server.arg("pass");
    
    preferences.begin("wifi-config", false);
    preferences.putString("ssid", req_ssid);
    preferences.putString("pass", req_pass);
    preferences.end();

    String responseMsg = "<!DOCTYPE html><html><head><meta charset='UTF-8'></head><body style='background:#0a0e17;color:#00ff88;text-align:center;padding-top:50px;font-family:sans-serif;'>";
    responseMsg += "<h2>Đã nhận thông tin Cấu hình!</h2>";
    responseMsg += "<p style='color:#fff;'>Đang tiến hành khởi động lại ESP32 để kết nối mạng: <b>" + req_ssid + "</b>...</p>";
    responseMsg += "</body></html>";
    
    server.send(200, "text/html", responseMsg);
    delay(2000);
    ESP.restart();
  } else {
    server.send(400, "text/plain", "Bad Request");
  }
}

void handleNotFound() {
  server.sendHeader("Location", String("http://") + apIP.toString(), true);
  server.send(302, "text/plain", "");
}

void startAccessPointMode() {
  isAPMode = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(apIP, apIP, netMsk);
  WiFi.softAP("Gas_Sensor_Config");

  dnsServer.start(DNS_PORT, "*", apIP);

  server.on("/", handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.onNotFound(handleNotFound);
  server.begin();

  setRGBRed();

  Serial.println("=========================================");
  Serial.println("   CHẾ ĐỘ CẤU HÌNH WI-FI (ACCESS POINT)   ");
  Serial.println("   SSID: Gas_Sensor_Config               ");
  Serial.println("   IP:   192.168.4.1                     ");
  Serial.println("=========================================");
}

bool connectToWiFi(String ssid, String pass) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  Serial.print("Đang kết nối tới Wi-Fi: ");
  Serial.println(ssid);

  int counter = 0;
  while (WiFi.status() != WL_CONNECTED && counter < (WIFI_CONNECT_TIMEOUT_SEC * 2)) {
    setRGBBlue();
    delay(250);
    setRGBOff();
    delay(250);
    Serial.print(".");
    counter++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ Kết nối Wi-Fi thành công!");
    Serial.print("   IP Address: ");
    Serial.println(WiFi.localIP());
    setRGBGreen();
    return true;
  } else {
    Serial.println("\n❌ Thất bại: Không thể kết nối tới Wi-Fi!");
    return false;
  }
}

// ====================================================================
// SETUP & LOOP
// ====================================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  // GPIO Config
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_BLUE_PIN, OUTPUT);
  setRGBOff();

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  pinMode(MQ2_PIN, INPUT);

  // MQTT Config
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setCallback(mqttCallback);

  preferences.begin("wifi-config", true);
  ssid_saved = preferences.getString("ssid", "");
  pass_saved = preferences.getString("pass", "");
  preferences.end();

  if (ssid_saved.length() > 0) {
    bool success = connectToWiFi(ssid_saved, pass_saved);
    if (!success) {
      startAccessPointMode();
    }
  } else {
    startAccessPointMode();
  }
}

void loop() {
  if (isAPMode) {
    dnsServer.processNextRequest();
    server.handleClient();
  } else {
    if (WiFi.status() == WL_CONNECTED) {
      if (!mqttClient.connected()) {
        reconnectMQTT();
      } else {
        mqttClient.loop();
      }

      readAndPublishGasData();

    } else {
      Serial.println("Mất kết nối Wi-Fi! Đang thử kết nối lại...");
      connectToWiFi(ssid_saved, pass_saved);
    }
  }
}
.processNextRequest();
    server.handleClient();
  } else {
    // Trong chế độ hoạt động bình thường (STATION MODE):
    // Giữ kiểm tra trạng thái kết nối Wi-Fi
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("Mất kết nối Wi-Fi! Đang thử kết nối lại...");
      connectToWiFi(ssid_saved, pass_saved);
    }
  }
}
