#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <DHT.h>
#include <LiquidCrystal_I2C.h>

// ===================== CONFIG =====================

// Wi-Fi
const char* WIFI_SSID = "Nha Moi";
const char* WIFI_PASSWORD = "123456tt";

// Mosquitto trên laptop
const char* MQTT_SERVER = "192.168.1.6";
const uint16_t MQTT_PORT = 1883;

// LCD và module output
const uint8_t LCD_ADDRESS = 0x27;
const bool RGB_COMMON_ANODE = false;
const bool BUZZER_ACTIVE_HIGH = true;

// Ngưỡng MQ-2
const uint16_t GAS_ALERT_THRESHOLD = 2500;
const uint16_t GAS_CLEAR_THRESHOLD = 2200;

// Thời gian làm nóng MQ-2: 180.000 ms = 3 phút
const uint32_t MQ2_WARMUP_MS = 180000UL;

// =================================================================

// ===================== CHÂN THIẾT BỊ =====================

const uint8_t MQ2_PIN = 34;
const uint8_t BUZZER_PIN = 26;

const uint8_t RGB_R_PIN = 25;
const uint8_t RGB_G_PIN = 32;
const uint8_t RGB_B_PIN = 33;

const uint8_t DHT_PIN = 27;

const uint8_t I2C_SDA_PIN = 13;
const uint8_t I2C_SCL_PIN = 14;

// ===================== MQTT =====================

// Không còn MSSV
const char* DEVICE_ID = "ESP32-GAS-MONITOR";

// Topic dữ liệu MQ-2
const char* TOPIC_GAS_DATA = "gas/sensor/data";

// Topic thay đổi trạng thái ALERT/SAFE
const char* TOPIC_GAS_ALERT = "gas/sensor/alert";

// Server hoặc MQTT Explorer gửi ON/OFF vào đây
const char* TOPIC_BUZZER_SET = "gas/control/buzzer";

// ESP32 phản hồi trạng thái thực tế của buzzer
const char* TOPIC_BUZZER_STATE = "gas/status/buzzer";

// ===================== ĐỐI TƯỢNG =====================

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

DHT dht(DHT_PIN, DHT11);
LiquidCrystal_I2C lcd(LCD_ADDRESS, 16, 2);

// ===================== TRẠNG THÁI =====================

uint16_t gasRaw = 0;

bool gasAlert = false;
bool remoteBuzzer = false;
bool buzzerOutput = false;

uint32_t lastWiFiAttempt = 0;
uint32_t lastMQTTAttempt = 0;
uint32_t lastGasRead = 0;
uint32_t lastGasPublish = 0;
uint32_t lastDhtRead = 0;

// ===================== OUTPUT =====================

void writeOutput(uint8_t pin, bool on, bool activeHigh) {
  digitalWrite(
    pin,
    (on == activeHigh) ? HIGH : LOW
  );
}

void setRGB(bool red, bool green, bool blue) {
  const bool activeHigh = !RGB_COMMON_ANODE;

  writeOutput(RGB_R_PIN, red, activeHigh);
  writeOutput(RGB_G_PIN, green, activeHigh);
  writeOutput(RGB_B_PIN, blue, activeHigh);
}

void publishBuzzerState() {
  if (!mqttClient.connected()) {
    return;
  }

  mqttClient.publish(
    TOPIC_BUZZER_STATE,
    buzzerOutput ? "ON" : "OFF",
    true
  );

  Serial.print("Buzzer state: ");
  Serial.println(buzzerOutput ? "ON" : "OFF");
}

void updateBuzzer() {
  /*
   * Buzzer bật khi:
   * - Phát hiện gas vượt ngưỡng
   * HOẶC
   * - Nhận lệnh ON từ MQTT
   *
   * Khi gas đang cảnh báo, gửi OFF từ MQTT
   * cũng không làm tắt cảnh báo tự động.
   */
  bool required = gasAlert || remoteBuzzer;

  if (required == buzzerOutput) {
    return;
  }

  buzzerOutput = required;

  writeOutput(
    BUZZER_PIN,
    buzzerOutput,
    BUZZER_ACTIVE_HIGH
  );

  publishBuzzerState();
}

void updateRGB() {
  if (gasAlert) {
    // Đỏ: đang cảnh báo gas
    setRGB(true, false, false);
  }
  else if (
    WiFi.status() == WL_CONNECTED &&
    mqttClient.connected()
  ) {
    // Xanh lá: hoạt động bình thường
    setRGB(false, true, false);
  }
  else {
    // Vàng: chưa kết nối Wi-Fi hoặc MQTT
    setRGB(true, true, false);
  }
}

// ===================== LCD + DHT11 =====================

void printLCD(uint8_t row, const char* text) {
  char line[17];

  snprintf(
    line,
    sizeof(line),
    "%-16.16s",
    text
  );

  lcd.setCursor(0, row);
  lcd.print(line);
}

void readDHT11() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();

  if (
    isnan(humidity) ||
    isnan(temperature)
  ) {
    printLCD(0, "DHT11 ERROR");
    printLCD(1, "");

    Serial.println("DHT11 read failed");
    return;
  }

  char line[17];

  snprintf(
    line,
    sizeof(line),
    "Temp: %.1f C",
    temperature
  );
  printLCD(0, line);

  snprintf(
    line,
    sizeof(line),
    "Hum: %.1f %%",
    humidity
  );
  printLCD(1, line);
}

// ===================== MQTT CALLBACK =====================

void mqttCallback(
  char* topic,
  byte* payload,
  unsigned int length
) {
  Serial.print("MQTT received [");
  Serial.print(topic);
  Serial.print("]: ");

  String command;

  for (unsigned int i = 0; i < length; i++) {
    command += static_cast<char>(payload[i]);
  }

  command.trim();
  command.toUpperCase();

  Serial.println(command);

  // Chỉ xử lý lệnh buzzer
  if (strcmp(topic, TOPIC_BUZZER_SET) != 0) {
    return;
  }

  if (command == "ON" || command == "1") {
    remoteBuzzer = true;
  }
  else if (command == "OFF" || command == "0") {
    remoteBuzzer = false;
  }
  else {
    Serial.println("Invalid buzzer command");
    return;
  }

  updateBuzzer();
}

// ===================== PUBLISH GAS =====================

void publishGasAlert() {
  if (!mqttClient.connected()) {
    return;
  }

  char payload[150];

  snprintf(
    payload,
    sizeof(payload),
    "{\"deviceId\":\"%s\","
    "\"gasRaw\":%u,"
    "\"state\":\"%s\"}",
    DEVICE_ID,
    gasRaw,
    gasAlert ? "ALERT" : "SAFE"
  );

  bool success = mqttClient.publish(
    TOPIC_GAS_ALERT,
    payload,
    true
  );

  if (success) {
    Serial.print("Gas alert published: ");
    Serial.println(payload);
  }
  else {
    Serial.println("Gas alert publish failed");
  }
}

void publishGasData() {
  if (!mqttClient.connected()) {
    return;
  }

  bool ready = millis() >= MQ2_WARMUP_MS;

  char payload[180];

  snprintf(
    payload,
    sizeof(payload),
    "{\"deviceId\":\"%s\","
    "\"gasRaw\":%u,"
    "\"alert\":%s,"
    "\"ready\":%s}",
    DEVICE_ID,
    gasRaw,
    gasAlert ? "true" : "false",
    ready ? "true" : "false"
  );

  bool success = mqttClient.publish(
    TOPIC_GAS_DATA,
    payload
  );

  if (success) {
    Serial.print("Gas data published: ");
    Serial.println(payload);
  }
  else {
    Serial.println("Gas data publish failed");
  }
}

// ===================== MQTT CONNECTION =====================

void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (mqttClient.connected()) {
    return;
  }

  uint32_t now = millis();

  if (now - lastMQTTAttempt < 5000) {
    return;
  }

  lastMQTTAttempt = now;

  Serial.print("Connecting MQTT to ");
  Serial.print(MQTT_SERVER);
  Serial.print(":");
  Serial.println(MQTT_PORT);

  if (mqttClient.connect(DEVICE_ID)) {
    Serial.println("MQTT connected");

    bool subscribed = mqttClient.subscribe(
      TOPIC_BUZZER_SET
    );

    if (subscribed) {
      Serial.print("Subscribed: ");
      Serial.println(TOPIC_BUZZER_SET);
    }
    else {
      Serial.println("MQTT subscribe failed");
    }

    // Gửi trạng thái buzzer hiện tại
    publishBuzzerState();

    // Khi MQ-2 đã làm nóng, gửi trạng thái gas hiện tại
    if (millis() >= MQ2_WARMUP_MS) {
      publishGasAlert();
    }
  }
  else {
    Serial.print("MQTT connection failed, state: ");
    Serial.println(mqttClient.state());
  }
}

// ===================== WI-FI =====================

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  uint32_t now = millis();

  if (now - lastWiFiAttempt < 10000) {
    return;
  }

  lastWiFiAttempt = now;

  Serial.println("Reconnecting Wi-Fi...");

  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void startWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  Serial.print("Connecting Wi-Fi: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  lastWiFiAttempt = millis();
}

// ===================== MQ-2 =====================

void readMQ2() {
  uint32_t sum = 0;

  // Lấy trung bình 8 lần đọc để giảm nhiễu
  for (uint8_t i = 0; i < 8; i++) {
    sum += analogRead(MQ2_PIN);
  }

  gasRaw = sum / 8;
}

void updateGasAlert() {
  // Không cảnh báo khi MQ-2 chưa làm nóng đủ thời gian
  if (millis() < MQ2_WARMUP_MS) {
    return;
  }

  bool previousState = gasAlert;

  if (
    !gasAlert &&
    gasRaw >= GAS_ALERT_THRESHOLD
  ) {
    gasAlert = true;
  }
  else if (
    gasAlert &&
    gasRaw <= GAS_CLEAR_THRESHOLD
  ) {
    gasAlert = false;
  }

  // Chỉ publish khi trạng thái ALERT/SAFE thay đổi
  if (gasAlert != previousState) {
    Serial.print("Gas state changed: ");
    Serial.println(
      gasAlert ? "ALERT" : "SAFE"
    );

    updateBuzzer();
    publishGasAlert();
  }
}

// ===================== SETUP =====================

void setup() {
  Serial.begin(115200);

  // Khai báo chân
  pinMode(MQ2_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  pinMode(RGB_R_PIN, OUTPUT);
  pinMode(RGB_G_PIN, OUTPUT);
  pinMode(RGB_B_PIN, OUTPUT);

  // Tắt buzzer và RGB lúc khởi động
  writeOutput(
    BUZZER_PIN,
    false,
    BUZZER_ACTIVE_HIGH
  );

  setRGB(false, false, false);

  // ADC ESP32
  analogReadResolution(12);
  analogSetPinAttenuation(
    MQ2_PIN,
    ADC_11db
  );

  // LCD I2C
  Wire.begin(
    I2C_SDA_PIN,
    I2C_SCL_PIN
  );

  lcd.init();
  lcd.backlight();

  printLCD(0, "Room Monitor");
  printLCD(1, "Starting...");

  // DHT11
  dht.begin();

  // MQTT
  mqttClient.setServer(
    MQTT_SERVER,
    MQTT_PORT
  );

  mqttClient.setCallback(
    mqttCallback
  );

  mqttClient.setBufferSize(256);

  // Wi-Fi
  startWiFi();
}

// ===================== LOOP =====================

void loop() {
  connectWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    static bool printedWiFiInfo = false;

    if (!printedWiFiInfo) {
      printedWiFiInfo = true;

      Serial.println("Wi-Fi connected");
      Serial.print("ESP32 IP: ");
      Serial.println(WiFi.localIP());
    }
  }

  connectMQTT();

  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  uint32_t now = millis();

  // Đọc MQ-2 mỗi 500 ms
  if (now - lastGasRead >= 500) {
    lastGasRead = now;

    readMQ2();
    updateGasAlert();
  }

  // Gửi dữ liệu MQ-2 mỗi 5 giây
  if (now - lastGasPublish >= 5000) {
    lastGasPublish = now;

    publishGasData();
  }

  // Đọc DHT11 mỗi 2 giây
  if (now - lastDhtRead >= 2000) {
    lastDhtRead = now;

    readDHT11();
  }

  updateRGB();
}