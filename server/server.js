require('dotenv').config();

const { initializeFirebase } = require('./config/firebase');
const mqttService = require('./services/mqttService');

function startServer() {
  try {
    initializeFirebase();
    mqttService.init();
    console.log('MQTT to Firebase bridge started.');
  } catch (error) {
    console.error(`Server startup failed: ${error.message}`);
    process.exit(1);
  }
}

startServer();
