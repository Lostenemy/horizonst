import http from 'http';
import app from './app';
import { config } from './config';
import { initMqtt } from './services/mqttService';
import { startAlarmMonitor } from './services/alarmMonitor';
import { pool } from './db/pool';

const server = http.createServer(app);

const start = async () => {
  try {
    const client = await pool.connect();
    client.release();
    console.log('Connected to PostgreSQL');
    await initMqtt();
    startAlarmMonitor();
    server.listen(config.port, config.host, () => {
      console.log(`Server running on http://${config.host}:${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
};

start();
