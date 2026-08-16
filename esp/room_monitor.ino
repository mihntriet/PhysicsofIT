#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <Wire.h>
#include <DHT.h>
#include <LiquidCrystal_I2C.h>

const int MQ2_PIN = 34;
const int BUZZER_PIN = 26;
const int RGB_R_PIN = 25;
const int RGB_G_PIN = 32;
const int RGB_B_PIN = 33;
const int DHT_PIN = 27;
const int I2C_SDA_PIN = 13;
const int I2C_SCL_PIN = 14;
const int LCD_ADDRESS = 0x27;

const int GAS_ALERT_THRESHOLD = 1800;
const int GAS_CLEAR_THRESHOLD = 1600;
const int GAS_WARNING_THRESHOLD = 1350;

const int MQ2_WARMUP_MS = 180000;
const int WIFI_CONNECT_TIMEOUT_MS = 20000;
const int WIFI_RETRY_MS = 10000;
const int MQTT_RETRY_MS = 5000;
const int GAS_READ_MS = 500;
const int GAS_PUBLISH_MS = 5000;
const int DHT_READ_MS = 2000;
const int RGB_BLINK_MS = 500;

const char* DEVICE_ID = "H4N7K2";

char TOPIC_GAS_DATA[48];
char TOPIC_BUZZER_COMMAND[48];
char TOPIC_LED_COMMAND[48];
char TOPIC_WIFI_CONFIG[48];
char TOPIC_BUZZER_STATUS[48];
char TOPIC_LED_STATUS[48];
char TOPIC_AVAILABILITY[48];

void buildTopics() {
  snprintf(TOPIC_GAS_DATA, sizeof(TOPIC_GAS_DATA), "devices/%s/gas/data", DEVICE_ID);
  snprintf(TOPIC_BUZZER_COMMAND, sizeof(TOPIC_BUZZER_COMMAND), "devices/%s/control/buzzer", DEVICE_ID);
  snprintf(TOPIC_LED_COMMAND, sizeof(TOPIC_LED_COMMAND), "devices/%s/control/led", DEVICE_ID);
  snprintf(TOPIC_WIFI_CONFIG, sizeof(TOPIC_WIFI_CONFIG), "devices/%s/control/wifi-config", DEVICE_ID);
  snprintf(TOPIC_BUZZER_STATUS, sizeof(TOPIC_BUZZER_STATUS), "devices/%s/status/buzzer", DEVICE_ID);
  snprintf(TOPIC_LED_STATUS, sizeof(TOPIC_LED_STATUS), "devices/%s/status/led", DEVICE_ID);
  snprintf(TOPIC_AVAILABILITY, sizeof(TOPIC_AVAILABILITY), "devices/%s/status/availability", DEVICE_ID);
}

const char* MQTT_BROKER = "afffd1ca8ec3466095ad9b9cdd71b986.s1.eu.hivemq.cloud";
const int MQTT_PORT = 8883;
const char* MQTT_USERNAME = "";
const char* MQTT_PASSWORD = "";

WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);
WebServer portalServer(80);
DNSServer dnsServer;
Preferences preferences;
DHT dht(DHT_PIN, DHT11);
LiquidCrystal_I2C lcd(LCD_ADDRESS, 16, 2);

String wifiSsid;
String wifiPassword;
bool portalMode = false;
bool warmupReady = false;
bool gasAlert = false;
bool remoteBuzzer = false;
bool ledEnabled = true;
bool rgbBlinkOn = true;
bool wifiWasConnected = false;
bool mqttWasConnected = false;
int gasRaw = 0;

unsigned long warmupStart = 0;
unsigned long lastWiFiAttempt = 0;
unsigned long lastMQTTAttempt = 0;
unsigned long lastGasRead = 0;
unsigned long lastGasPublish = 0;
unsigned long lastDhtRead = 0;
unsigned long lastBlinkTime = 0;

void setRgb(bool red, bool green, bool blue) {
  digitalWrite(RGB_R_PIN, red ? HIGH : LOW);
  digitalWrite(RGB_G_PIN, green ? HIGH : LOW);
  digitalWrite(RGB_B_PIN, blue ? HIGH : LOW);
}

void updateRgbStatus() {
  if (!ledEnabled) {
    setRgb(false, false, false);
    return;
  }

  if (gasAlert) {
    setRgb(true, false, false);
    return;
  }

  if (portalMode || WiFi.status() != WL_CONNECTED || !mqttClient.connected()) {
    if (millis() - lastBlinkTime >= RGB_BLINK_MS) {
      lastBlinkTime = millis();
      rgbBlinkOn = !rgbBlinkOn;
    }
    setRgb(false, false, rgbBlinkOn);
    return;
  }

  if (gasRaw >= GAS_WARNING_THRESHOLD) {
    setRgb(true, true, false);
  } else {
    setRgb(false, true, false);
  }
}

void readDHT11() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();

  if (isnan(humidity) || isnan(temperature)) {
    printLCD(0, "DHT11 ERROR");
    printLCD(1, "");
    return;
  }

  char line[17];
  char value[8];

  // Nhiệt độ
  dtostrf(temperature, 0, 1, value);
  strcpy(line, "Temp: ");
  strcat(line, value);
  strcat(line, " C");
  printLCD(0, line);

  // Độ ẩm
  dtostrf(humidity, 0, 1, value);
  strcpy(line, "Hum: ");
  strcat(line, value);
  strcat(line, " %");
  printLCD(1, line);
}

void printLCD(int row, const char* text) {
  // Xóa cả dòng trước
  lcd.setCursor(0, row);
  lcd.print("                ");  // 16 khoảng trắng

  // Quay lại đầu dòng và in nội dung mới
  lcd.setCursor(0, row);
  lcd.print(text);
}

void readMQ2() {
  int sum = 0;
  for (int i = 0; i < 8; i++) {
    sum += analogRead(MQ2_PIN);
  }
  gasRaw = sum / 8;
}

void updateBuzzer() {
  bool buzzerOn = gasAlert || remoteBuzzer;
  digitalWrite(BUZZER_PIN, buzzerOn ? HIGH : LOW);

  if (!mqttClient.connected()) return;

  const char* reason = gasAlert ? "GAS_ALARM" : remoteBuzzer ? "REMOTE" : "NONE";
  
  char payload[64];
  strcpy(payload, "{\"state\":\"");
  if (buzzerOn) {
    strcat(payload, "ON");
  } else {
    strcat(payload, "OFF");
  }
  strcat(payload, "\",\"reason\":\"");
  strcat(payload, reason);
  strcat(payload, "\"}");
  mqttClient.publish(TOPIC_BUZZER_STATUS, payload, true);
}

void publishLedStatus() {
  if (!mqttClient.connected()) return;
  mqttClient.publish(TOPIC_LED_STATUS, ledEnabled ? "ON" : "OFF", true);
}

void publishGasData() {
  if (!mqttClient.connected()) return;

  char payload[180];
  char gasText[10];
  
  // Đổi gasRaw từ int thành char
  itoa(gasRaw, gasText, 10);
  strcpy(payload, "{\"deviceId\":\"");
  strcat(payload, DEVICE_ID);
  strcat(payload, "\",\"gasRaw\":");
  strcat(payload, gasText);
  strcat(payload, ",\"alert\":");
  if (gasAlert) {
    strcat(payload, "true");
  } else {
    strcat(payload, "false");
  }
  strcat(payload, ",\"ready\":");
  if (warmupReady) {
    strcat(payload, "true");
  } else {
    strcat(payload, "false");
  }
  strcat(payload, "}");
  
  mqttClient.publish(TOPIC_GAS_DATA, payload, true);
}

void updateGasAlert() {
  if (!warmupReady) {
    if (millis() - warmupStart < MQ2_WARMUP_MS) return;

    warmupReady = true;
    gasAlert = false;
    Serial.println("[GAS] SAFE");
    updateBuzzer();
    publishGasData();
    return;
  }

  bool previous = gasAlert;
  if (!gasAlert && gasRaw >= GAS_ALERT_THRESHOLD) {
    gasAlert = true;
  } else if (gasAlert && gasRaw <= GAS_CLEAR_THRESHOLD) {
    gasAlert = false;
  }

  if (gasAlert != previous) {
    Serial.println(gasAlert ? "[GAS] ALERT" : "[GAS] SAFE");
    updateBuzzer();
    publishGasData();
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String command;
  command.reserve(length);
  for (unsigned int i = 0; i < length; i++) {
    command += static_cast<char>(payload[i]);
  }
  command.trim();
  command.toUpperCase();

  if (strcmp(topic, TOPIC_WIFI_CONFIG) == 0) {
    if (command == "START") startWifiSetupMode();
  } else if (strcmp(topic, TOPIC_BUZZER_COMMAND) == 0) {
    if (command == "ON") {
      remoteBuzzer = true;
    } else if (command == "OFF") {
      remoteBuzzer = false;
    } else {
      return;
    }
    updateBuzzer();
  } else if (strcmp(topic, TOPIC_LED_COMMAND) == 0) {
    if (command == "ON") {
      ledEnabled = true;
    } else if (command == "OFF") {
      ledEnabled = false;
    } else {
      return;
    }
    updateRgbStatus();
    publishLedStatus();
  }
}

void connectMQTT() {
  if (millis() - lastMQTTAttempt < MQTT_RETRY_MS) return;
  lastMQTTAttempt = millis();
  Serial.println("[MQTT] Connecting...");

  if (!mqttClient.connect(
        DEVICE_ID,
        MQTT_USERNAME,
        MQTT_PASSWORD,
        TOPIC_AVAILABILITY,
        1,
        true,
        "OFFLINE"
      )) return;

  mqttWasConnected = true;
  mqttClient.publish(TOPIC_AVAILABILITY, "ONLINE", true);
  mqttClient.subscribe(TOPIC_BUZZER_COMMAND, 1);
  mqttClient.subscribe(TOPIC_LED_COMMAND, 1);
  mqttClient.subscribe(TOPIC_WIFI_CONFIG, 1);
  updateBuzzer();
  publishGasData();
  publishLedStatus();
  Serial.println("[MQTT] Connected");
}

void loadWifiConfig() {
  preferences.begin("gas-monitor", true);
  wifiSsid = preferences.getString("wifiSsid", "");
  wifiPassword = preferences.getString("wifiPass", "");
  preferences.end();
}

bool connectSavedWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  unsigned long startedAt = millis();
  Serial.println("[WiFi] Connecting...");

  while (WiFi.status() != WL_CONNECTED
         && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    updateRgbStatus();
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      Serial.print("[WiFi] Connected: ");
      Serial.println(WiFi.localIP());
    }
    return;
  }

  if (wifiWasConnected) {
    wifiWasConnected = false;
    Serial.println("[WiFi] Disconnected");
  }
  if (millis() - lastWiFiAttempt < WIFI_RETRY_MS) return;

  lastWiFiAttempt = millis();
  Serial.println("[WiFi] Connecting...");
  WiFi.disconnect();
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
}

String portalPage() {
  return F(
    "<!doctype html><html lang='vi'><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Configure Wi-Fi</title><style>"
    "body{font-family:Arial;background:#0a0e17;color:#e2e8f0;padding:20px}"
    ".card{max-width:440px;margin:auto;background:#111827;padding:24px;border-radius:16px}"
    "label{display:block;margin-top:14px;color:#94a3b8}input{width:100%;box-sizing:border-box;padding:11px;margin-top:6px;background:#1e293b;color:white;border:1px solid #334155;border-radius:8px}"
    "button{width:100%;margin-top:22px;padding:12px;background:#00ff88;border:0;border-radius:8px;font-weight:bold}"
    "</style></head><body><div class='card'><h2>Configure Wi-Fi</h2>"
    "<form method='post' action='/save'>"
    "<label>Wi-Fi SSID:</label><input name='ssid' required>"
    "<label>Wi-Fi Password:</label><input type='password' name='wifiPass' required>"
    "<button type='submit'>Save &amp; Connect</button></form></div></body></html>"
  );
}

void handlePortalRoot() {
  portalServer.send(200, "text/html; charset=utf-8", portalPage());
}

void handlePortalSave() {
  String newSsid = portalServer.arg("ssid");
  String newPassword = portalServer.arg("wifiPass");
  newSsid.trim();

  if (!portalServer.hasArg("ssid")
      || !portalServer.hasArg("wifiPass")
      || newSsid.length() == 0
      || newPassword.length() == 0) {
    portalServer.send(400, "text/plain; charset=utf-8", "Cấu hình không hợp lệ.");
    return;
  }

  preferences.begin("gas-monitor", false);
  preferences.putString("wifiSsid", newSsid);
  preferences.putString("wifiPass", newPassword);
  preferences.end();

  portalServer.send(200, "text/html; charset=utf-8", "<h2>Đã lưu. ESP32 đang khởi động lại...</h2>");
  delay(1000);
  ESP.restart();
}

void startWifiSetupMode() {
  if (portalMode) return;

  Serial.println("[WiFi] Config mode");
  portalMode = true;
  if (mqttClient.connected()) {
    mqttClient.publish(TOPIC_AVAILABILITY, "OFFLINE", true);
    mqttClient.disconnect();
    mqttWasConnected = false;
    Serial.println("[MQTT] Disconnected");
  }

  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_AP);

  char suffix[7];
  snprintf(suffix, sizeof(suffix), "%06llX", ESP.getEfuseMac() & 0xFFFFFFULL);
  String apName = "Gas_Monitor_" + String(suffix);
  String apPassword = "GAS-" + String(suffix);
  IPAddress apIp(192, 168, 4, 1);
  WiFi.softAPConfig(apIp, apIp, IPAddress(255, 255, 255, 0));
  WiFi.softAP(apName.c_str(), apPassword.c_str());

  dnsServer.start(53, "*", apIp);
  portalServer.on("/", HTTP_GET, handlePortalRoot);
  portalServer.on("/save", HTTP_POST, handlePortalSave);
  portalServer.onNotFound([]() {
    portalServer.sendHeader("Location", "http://192.168.4.1", true);
    portalServer.send(302, "text/plain", "");
  });
  portalServer.begin();

  Serial.print("[WiFi] AP: ");
  Serial.println(apName);
  Serial.println("[WiFi] Open http://192.168.4.1");
}

void setup() {
  Serial.begin(115200);
  buildTopics();
  warmupStart = millis();

  pinMode(MQ2_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RGB_R_PIN, OUTPUT);
  pinMode(RGB_G_PIN, OUTPUT);
  pinMode(RGB_B_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  setRgb(false, false, false);

  analogReadResolution(12);
  analogSetPinAttenuation(MQ2_PIN, ADC_11db);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  lcd.init();
  lcd.backlight();
  printLCD(0, "Room Monitor");
  printLCD(1, "Starting...");
  dht.begin();

  secureClient.setInsecure();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  loadWifiConfig();
  if (wifiSsid.length() == 0 || !connectSavedWiFi()) {
    startWifiSetupMode();
  }
}

void loop() {
  unsigned long now = millis();

  if (now - lastGasRead >= GAS_READ_MS) {
    lastGasRead = now;
    readMQ2();
    updateGasAlert();
  }
  if (now - lastDhtRead >= DHT_READ_MS) {
    lastDhtRead = now;
    readDHT11();
  }

  if (portalMode) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
  } else {
    maintainWiFi();
    if (WiFi.status() == WL_CONNECTED) {
      if (mqttClient.connected()) {
        mqttClient.loop();
      } else {
        connectMQTT();
      }
    }
  }

  if (mqttWasConnected && !mqttClient.connected()) {
    mqttWasConnected = false;
    Serial.println("[MQTT] Disconnected");
  }
  if (now - lastGasPublish >= GAS_PUBLISH_MS) {
    lastGasPublish = now;
    publishGasData();
  }

  updateRgbStatus();
}
