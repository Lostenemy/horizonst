import http from 'http';
import app from './app';
import { config } from './config';
import { initMqtt } from './services/mqttService';
import { startAlarmMonitor } from './services/alarmMonitor';
import { pool } from './db/pool';
import { runMigrations } from './db/migrations';
import { ensureEmqxMessageAudit } from './services/emqxAudit';

const server = http.createServer(app);

const start = async () => {
  try {
    const client = await pool.connect();
    client.release();
    console.log('Connected to PostgreSQL');
    await runMigrations();
    console.log('Database migrations applied');
    if (config.mqtt.persistenceMode === 'emqx') {
      const auditResult = await ensureEmqxMessageAudit();
      if (auditResult === 'unsupported') {
        config.mqtt.persistenceMode = 'app';
        console.warn('Falling back to application-level MQTT message persistence.');
      }
    }
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
