import http from 'http';
import app from './app';
import { config } from './config';
import { initMqtt, stopMqtt } from './services/mqttService';
import { startAlarmMonitor } from './services/alarmMonitor';
import { pool, databaseLifecycle } from './db/pool';
import { lifecycle } from './lifecycle';
import { runMigrations } from './db/migrations';
import { ensureEmqxMessageAudit } from './services/emqxAudit';
import { verifyMailConnection } from './services/mail';
import { startMqttStorageMaintenance } from './services/storageMaintenance';
import {
  expireStaleGatewayCommands,
  startGatewayCommandTimeoutSweep
} from './services/gatewayCommands';

const server = http.createServer(app);
lifecycle.install(server, stopMqtt, () => databaseLifecycle.close());

const start = async () => {
  try {
    const client = await pool.connect();
    client.release();
    if (lifecycle.stopping) return;
    console.log('Connected to PostgreSQL');
    await runMigrations();
    if (lifecycle.stopping) return;
    console.log('Database migrations applied');
    await expireStaleGatewayCommands();
    startGatewayCommandTimeoutSweep();
    if (config.mail.enabled) {
      try {
        await verifyMailConnection();
        console.log('Mail server ready to deliver messages');
      } catch (mailError) {
        console.error('Mail server verification failed', mailError);
      }
    } else {
      console.warn('Mail delivery disabled via configuration');
    }
    if (config.mqtt.persistenceMode === 'emqx') {
      const auditResult = await ensureEmqxMessageAudit();
      if (auditResult === 'unsupported') {
        config.mqtt.persistenceMode = 'app';
        console.warn('Falling back to application-level MQTT message persistence.');
      }
    }
    if (lifecycle.stopping) return;
    await initMqtt();
    if (lifecycle.stopping) return;
    startAlarmMonitor();
    startMqttStorageMaintenance();
    server.listen(config.port, config.host, () => {
      console.log(`Server running on http://${config.host}:${config.port}`);
    });
  } catch (error) {
    if (lifecycle.stopping) return;
    console.error('Failed to start server', error);
    process.exit(1);
  }
};

void lifecycle.track(start());
