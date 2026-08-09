#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <DHT.h>
#include <LiquidCrystal_I2C.h>

// Hardware wiring used by the final device.
const uint8_t MQ2_PIN = 34;
const uint8_t BUZZER_PIN = 26;
const uint8_t RGB_R_PIN = 25;
const uint8_t RGB_G_PIN = 32;
const uint8_t RGB_B_PIN = 33;
const uint8_t DHT_PIN = 27;
const uint8_t I2C_SDA_PIN = 13;
const uint8_t I2C_SCL_PIN = 14;
const uint8_t CONFIG_BUTTON_PIN = 0;  // Hold the ESP32 BOOT button for 5 seconds.

const uint8_t LCD_ADDRESS = 0x27;
const bool RGB_COMMON_ANODE = false;
const bool BUZZER_ACTIVE_HIGH = true;

const uint16_t GAS_ALERT_THRESHOLD = 2500;
const uint16_t GAS_CLEAR_THRESHOLD = 2200;
const uint32_t MQ2_WARMUP_MS = 180000UL;

const char* DEVICE_ID = "ESP32-GAS-MONITOR";
const char* TOPIC_GAS_DATA = "devices/ESP32-GAS-MONITOR/gas/data";
const char* TOPIC_GAS_ALERT = "devices/ESP32-GAS-MONITOR/gas/alert";
const char* TOPIC_BUZZER_COMMAND = "devices/ESP32-GAS-MONITOR/control/buzzer";
const char* TOPIC_BUZZER_STATUS = "devices/ESP32-GAS-MONITOR/status/buzzer";
const char* TOPIC_AVAILABILITY = "devices/ESP32-GAS-MONITOR/status/availability";

const uint16_t DEFAULT_MQTT_PORT = 1883;
const uint32_t WIFI_CONNECT_TIMEOUT_MS = 20000UL;
const uint32_t CONNECTION_FAILURE_PORTAL_MS = 60000UL;

struct DeviceConfig {
  String wifiSsid;
  String wifiPassword;
  String brokerHost;
  uint16_t brokerPort;
  String mqttUsername;
  String mqttPassword;
};

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
WebServer portalServer(80);
DNSServer dnsServer;
Preferences preferences;
DHT dht(DHT_PIN, DHT11);
LiquidCrystal_I2C lcd(LCD_ADDRESS, 16, 2);

DeviceConfig config;
bool portalMode = false;
bool warmupReady = false;
bool gasAlert = false;
bool remoteBuzzer = false;
bool actualBuzzer = false;
uint16_t gasRaw = 0;

uint32_t bootTime = 0;
uint32_t lastWiFiAttempt = 0;
uint32_t connectionFailureStartedAt = 0;
uint32_t lastMQTTAttempt = 0;
uint32_t lastGasRead = 0;
uint32_t lastGasPublish = 0;
uint32_t lastDhtRead = 0;
uint32_t configButtonPressedAt = 0;

void writeOutput(uint8_t pin, bool on, bool activeHigh) {
  digitalWrite(pin, (on == activeHigh) ? HIGH : LOW);
}

void setRGB(bool red, bool green, bool blue) {
  const bool activeHigh = !RGB_COMMON_ANODE;
  writeOutput(RGB_R_PIN, red, activeHigh);
  writeOutput(RGB_G_PIN, green, activeHigh);
  writeOutput(RGB_B_PIN, blue, activeHigh);
}

void updateRGB() {
  if (gasAlert) {
    setRGB(true, false, false);
  } else if (WiFi.status() == WL_CONNECTED && mqttClient.connected()) {
    setRGB(false, true, false);
  } else {
    setRGB(true, true, false);
  }
}

void printLCD(uint8_t row, const char* text) {
  char line[17];
  snprintf(line, sizeof(line), "%-16.16s", text);
  lcd.setCursor(0, row);
  lcd.print(line);
}

void readDHT11() {
  const float humidity = dht.readHumidity();
  const float temperature = dht.readTemperature();

  if (isnan(humidity) || isnan(temperature)) {
    printLCD(0, "DHT11 ERROR");
    printLCD(1, "");
    return;
  }

  char line[17];
  snprintf(line, sizeof(line), "Temp: %.1f C", temperature);
  printLCD(0, line);
  snprintf(line, sizeof(line), "Hum: %.1f %%", humidity);
  printLCD(1, line);
}

const char* buzzerReason() {
  if (gasAlert) return "GAS_ALARM";
  if (remoteBuzzer) return "REMOTE";
  return "NONE";
}

void publishBuzzerStatus() {
  if (!mqttClient.connected()) return;

  char payload[64];
  snprintf(
    payload,
    sizeof(payload),
    "{\"state\":\"%s\",\"reason\":\"%s\"}",
    actualBuzzer ? "ON" : "OFF",
    buzzerReason()
  );
  mqttClient.publish(TOPIC_BUZZER_STATUS, payload, true);
}

void updateBuzzer(bool forcePublish = false) {
  const bool required = gasAlert || remoteBuzzer;
  const bool changed = required != actualBuzzer;
  actualBuzzer = required;
  writeOutput(BUZZER_PIN, actualBuzzer, BUZZER_ACTIVE_HIGH);

  if (changed || forcePublish) {
    publishBuzzerStatus();
  }
}

void publishGasAlert() {
  if (!mqttClient.connected() || !warmupReady) return;

  char payload[150];
  snprintf(
    payload,
    sizeof(payload),
    "{\"deviceId\":\"%s\",\"gasRaw\":%u,\"state\":\"%s\"}",
    DEVICE_ID,
    gasRaw,
    gasAlert ? "ALERT" : "SAFE"
  );
  mqttClient.publish(TOPIC_GAS_ALERT, payload, true);
}

void publishGasData() {
  if (!mqttClient.connected()) return;

  char payload[180];
  snprintf(
    payload,
    sizeof(payload),
    "{\"deviceId\":\"%s\",\"gasRaw\":%u,\"alert\":%s,\"ready\":%s}",
    DEVICE_ID,
    gasRaw,
    gasAlert ? "true" : "false",
    warmupReady ? "true" : "false"
  );
  mqttClient.publish(TOPIC_GAS_DATA, payload);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, TOPIC_BUZZER_COMMAND) != 0) return;

  String command;
  command.reserve(length);
  for (unsigned int i = 0; i < length; i++) {
    command += static_cast<char>(payload[i]);
  }
  command.trim();
  command.toUpperCase();

  if (command == "ON") {
    remoteBuzzer = true;
  } else if (command == "OFF") {
    remoteBuzzer = false;
  } else {
    return;
  }

  // Publish even when GAS_ALARM keeps the physical buzzer ON.
  updateBuzzer(true);
}

void readMQ2() {
  uint32_t sum = 0;
  for (uint8_t i = 0; i < 8; i++) {
    sum += analogRead(MQ2_PIN);
  }
  gasRaw = sum / 8;
}

void updateGasAlert() {
  if (!warmupReady) {
    if (millis() - bootTime < MQ2_WARMUP_MS) return;

    // Announce SAFE once so a later high sample is a real SAFE -> ALERT transition.
    warmupReady = true;
    gasAlert = false;
    updateBuzzer(true);
    publishGasAlert();
    return;
  }

  const bool previous = gasAlert;
  if (!gasAlert && gasRaw >= GAS_ALERT_THRESHOLD) {
    gasAlert = true;
  } else if (gasAlert && gasRaw <= GAS_CLEAR_THRESHOLD) {
    gasAlert = false;
  }

  if (gasAlert != previous) {
    updateBuzzer(true);
    publishGasAlert();
  }
}

void loadConfig() {
  preferences.begin("gas-monitor", true);
  config.wifiSsid = preferences.getString("wifiSsid", "");
  config.wifiPassword = preferences.getString("wifiPass", "");
  config.brokerHost = preferences.getString("mqttHost", "");
  config.brokerPort = preferences.getUShort("mqttPort", DEFAULT_MQTT_PORT);
  config.mqttUsername = preferences.getString("mqttUser", "");
  config.mqttPassword = preferences.getString("mqttPass", "");
  preferences.end();
}

bool hasSavedConfig() {
  return config.wifiSsid.length() > 0
    && config.brokerHost.length() > 0
    && config.mqttUsername.length() > 0
    && config.mqttPassword.length() > 0;
}

void clearConfigAndRestart() {
  if (mqttClient.connected()) {
    mqttClient.publish(TOPIC_AVAILABILITY, "OFFLINE", true);
    mqttClient.disconnect();
  }
  preferences.begin("gas-monitor", false);
  preferences.clear();
  preferences.end();
  delay(300);
  ESP.restart();
}

String escapeHtml(const String& value) {
  String escaped;
  escaped.reserve(value.length() + 8);
  for (size_t i = 0; i < value.length(); i++) {
    const char character = value.charAt(i);
    if (character == '&') escaped += "&amp;";
    else if (character == '<') escaped += "&lt;";
    else if (character == '>') escaped += "&gt;";
    else if (character == '\"') escaped += "&quot;";
    else if (character == '\'') escaped += "&#39;";
    else escaped += character;
  }
  return escaped;
}

String networkOptions() {
  const int count = WiFi.scanNetworks();
  String options;
  for (int i = 0; i < count; i++) {
    const String escapedSsid = escapeHtml(WiFi.SSID(i));
    options += "<option value='" + escapedSsid + "'>" + escapedSsid;
    options += " (" + String(WiFi.RSSI(i)) + " dBm)</option>";
  }
  if (count <= 0) options = "<option value=''>Không tìm thấy Wi-Fi</option>";
  WiFi.scanDelete();
  return options;
}

String portalPage() {
  String html = F(
    "<!doctype html><html lang='vi'><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Gas Monitor Setup</title><style>"
    "body{font-family:Arial;background:#0a0e17;color:#e2e8f0;padding:20px}"
    ".card{max-width:440px;margin:auto;background:#111827;padding:24px;border-radius:16px}"
    "label{display:block;margin-top:14px;color:#94a3b8}input,select{width:100%;box-sizing:border-box;padding:11px;margin-top:6px;background:#1e293b;color:white;border:1px solid #334155;border-radius:8px}"
    "button{width:100%;margin-top:22px;padding:12px;background:#00ff88;border:0;border-radius:8px;font-weight:bold}"
    "small{color:#94a3b8}</style></head><body><div class='card'>"
    "<h2>Cấu hình ESP32 Gas Monitor</h2><small>Thiết bị kết nối trực tiếp tới MQTT broker đã cấu hình.</small>"
    "<form method='post' action='/save'><label>Wi-Fi SSID</label><select name='ssid' required>"
  );
  html += networkOptions();
  html += F(
    "</select><label>Wi-Fi password</label><input type='password' name='wifiPass' required>"
    "<label>MQTT broker</label><input name='mqttHost' placeholder='Hostname hoặc IPv4' required>"
    "<label>MQTT port</label><input type='number' name='mqttPort' value='1883' min='1' max='65535' required>"
    "<label>MQTT username</label><input name='mqttUser' required>"
    "<label>MQTT password</label><input type='password' name='mqttPass' required>"
    "<button type='submit'>Lưu và khởi động lại</button></form></div></body></html>"
  );
  return html;
}

void handlePortalRoot() {
  portalServer.send(200, "text/html; charset=utf-8", portalPage());
}

void handlePortalSave() {
  const uint32_t portValue = portalServer.arg("mqttPort").toInt();
  String wifiSsid = portalServer.arg("ssid");
  String wifiPassword = portalServer.arg("wifiPass");
  String mqttHost = portalServer.arg("mqttHost");
  String mqttUsername = portalServer.arg("mqttUser");
  String mqttPassword = portalServer.arg("mqttPass");
  wifiSsid.trim();
  mqttHost.trim();
  mqttUsername.trim();

  if (!portalServer.hasArg("ssid")
      || !portalServer.hasArg("wifiPass")
      || !portalServer.hasArg("mqttHost")
      || !portalServer.hasArg("mqttUser")
      || !portalServer.hasArg("mqttPass")
      || wifiSsid.length() == 0
      || wifiPassword.length() == 0
      || mqttHost.length() == 0
      || mqttUsername.length() == 0
      || mqttPassword.length() == 0
      || portValue == 0
      || portValue > 65535) {
    portalServer.send(400, "text/plain; charset=utf-8", "Cấu hình không hợp lệ.");
    return;
  }

  preferences.begin("gas-monitor", false);
  preferences.putString("wifiSsid", wifiSsid);
  preferences.putString("wifiPass", wifiPassword);
  preferences.putString("mqttHost", mqttHost);
  preferences.putUShort("mqttPort", static_cast<uint16_t>(portValue));
  preferences.putString("mqttUser", mqttUsername);
  preferences.putString("mqttPass", mqttPassword);
  preferences.end();

  portalServer.send(200, "text/html; charset=utf-8", "<h2>Đã lưu. ESP32 đang khởi động lại...</h2>");
  delay(1000);
  ESP.restart();
}

void startCaptivePortal() {
  if (portalMode) return;

  portalMode = true;
  if (mqttClient.connected()) {
    mqttClient.publish(TOPIC_AVAILABILITY, "OFFLINE", true);
    mqttClient.disconnect();
  }

  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_AP_STA);

  char suffix[7];
  snprintf(suffix, sizeof(suffix), "%06llX", ESP.getEfuseMac() & 0xFFFFFFULL);
  const String apName = "Gas_Monitor_" + String(suffix);
  const String apPassword = "GAS-" + String(suffix);
  const IPAddress apIp(192, 168, 4, 1);
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

  Serial.println("Captive Portal started:");
  Serial.println(apName);
  Serial.print("Setup password: ");
  Serial.println(apPassword);
  Serial.println("Open http://192.168.4.1");
}

bool connectSavedWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(config.wifiSsid.c_str(), config.wifiPassword.c_str());
  const uint32_t startedAt = millis();

  while (WiFi.status() != WL_CONNECTED
         && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    connectionFailureStartedAt = 0;
    Serial.print("Wi-Fi connected. ESP32 IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }
  return false;
}

void configureMQTTBroker() {
  mqttClient.setServer(config.brokerHost.c_str(), config.brokerPort);
  Serial.printf(
    "[MQTT] Broker configured: %s:%u\n",
    config.brokerHost.c_str(),
    config.brokerPort
  );
}

void connectMQTT() {
  if (portalMode || WiFi.status() != WL_CONNECTED || mqttClient.connected()) return;
  if (millis() - lastMQTTAttempt < 5000) return;
  lastMQTTAttempt = millis();

  const bool connected = mqttClient.connect(
    DEVICE_ID,
    config.mqttUsername.c_str(),
    config.mqttPassword.c_str(),
    TOPIC_AVAILABILITY,
    1,
    true,
    "OFFLINE"
  );

  if (!connected) {
    Serial.print("MQTT connection failed, state: ");
    Serial.println(mqttClient.state());
    return;
  }

  mqttClient.publish(TOPIC_AVAILABILITY, "ONLINE", true);
  mqttClient.subscribe(TOPIC_BUZZER_COMMAND, 1);
  publishBuzzerStatus();
  if (warmupReady) publishGasAlert();
  Serial.println("MQTT connected.");
}

void maintainWiFi() {
  if (portalMode) return;
  if (WiFi.status() == WL_CONNECTED) {
    connectionFailureStartedAt = 0;
    return;
  }

  if (connectionFailureStartedAt == 0) connectionFailureStartedAt = millis();
  if (millis() - connectionFailureStartedAt >= CONNECTION_FAILURE_PORTAL_MS) {
    startCaptivePortal();
    return;
  }
  if (millis() - lastWiFiAttempt >= 10000) {
    lastWiFiAttempt = millis();
    WiFi.disconnect();
    WiFi.begin(config.wifiSsid.c_str(), config.wifiPassword.c_str());
  }
}

void handleConfigButton() {
  if (digitalRead(CONFIG_BUTTON_PIN) == LOW) {
    if (configButtonPressedAt == 0) configButtonPressedAt = millis();
    if (millis() - configButtonPressedAt >= 5000) clearConfigAndRestart();
  } else {
    configButtonPressedAt = 0;
  }
}

void setup() {
  Serial.begin(115200);
  bootTime = millis();

  pinMode(MQ2_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RGB_R_PIN, OUTPUT);
  pinMode(RGB_G_PIN, OUTPUT);
  pinMode(RGB_B_PIN, OUTPUT);
  pinMode(CONFIG_BUTTON_PIN, INPUT_PULLUP);
  writeOutput(BUZZER_PIN, false, BUZZER_ACTIVE_HIGH);
  setRGB(false, false, false);

  analogReadResolution(12);
  analogSetPinAttenuation(MQ2_PIN, ADC_11db);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  lcd.init();
  lcd.backlight();
  printLCD(0, "Room Monitor");
  printLCD(1, "Starting...");
  dht.begin();

  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(256);
  loadConfig();

  if (!hasSavedConfig() || !connectSavedWiFi()) {
    startCaptivePortal();
  } else {
    configureMQTTBroker();
  }
}

void loop() {
  handleConfigButton();

  if (portalMode) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
  } else {
    maintainWiFi();
    if (WiFi.status() == WL_CONNECTED) {
      connectMQTT();
      if (mqttClient.connected()) mqttClient.loop();
    }
  }

  const uint32_t now = millis();
  if (now - lastGasRead >= 500) {
    lastGasRead = now;
    readMQ2();
    updateGasAlert();
  }
  if (now - lastGasPublish >= 5000) {
    lastGasPublish = now;
    publishGasData();
  }
  if (now - lastDhtRead >= 2000) {
    lastDhtRead = now;
    readDHT11();
  }
  updateRGB();
}
