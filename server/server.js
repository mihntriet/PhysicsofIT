require('dotenv').config({ path: `${__dirname}/.env` });

const express = require('express');
const path = require('path');
const { deleteFirebaseApp, initializeFirebase } = require('./config/firebase');
const mqttService = require('./services/mqttService');
const firebaseService = require('./services/firebaseService');
const alertService = require('./services/alertService');
const apiRoutes = require('./routes/api');

const app = express();
const clientPath = path.join(__dirname, '..', 'client');
let httpServer = null;
let shuttingDown = false;

app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(clientPath));
app.use('/api', apiRoutes);

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(clientPath, 'dashboard.html'));
});

async function startServer() {
  initializeFirebase();

  mqttService.startMQTT({
    onGasData: (data) => firebaseService.saveGasData(data),
    onGasAlert: async (data) => {
      const transition = await firebaseService.saveGasAlert(data);
      void alertService.handleGasTransition(data, transition);
    },
    onBuzzerStatus: (data) => firebaseService.saveBuzzerStatus(data),
    onAvailability: (availability) => firebaseService.saveAvailability(availability),
  });

  const host = process.env.HOST || '0.0.0.0';
  const port = Number.parseInt(process.env.PORT, 10) || 3000;

  await new Promise((resolve, reject) => {
    httpServer = app.listen(port, host, resolve);
    httpServer.once('error', reject);
  });

  console.log(`Gas Monitor server listening on http://${host}:${port}.`);
  return httpServer;
}

async function gracefulShutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`${signal}: shutting down...`);

  await mqttService.stopMQTT();

  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }

  await deleteFirebaseApp();
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Server startup failed: ${error.message}`);
    process.exitCode = 1;
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      gracefulShutdown(signal)
        .then(() => process.exit(0))
        .catch((error) => {
          console.error(`Shutdown failed: ${error.message}`);
          process.exit(1);
        });
    });
  }
}

module.exports = { app, startServer, gracefulShutdown };
