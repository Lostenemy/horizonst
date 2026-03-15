import { config } from './config.js';
import { logger } from './logger.js';
import { runMigrations } from './db/migrate.js';
import { pool } from './db/pool.js';
import { createHttpServer } from './web/httpServer.js';
import { createSocketServer } from './web/socketServer.js';
import { startMqttClient } from './mqtt/client.js';
import { parseRfidMessage } from './mqtt/parser.js';
import { ToggleService } from './services/toggleService.js';

const start = async (): Promise<void> => {
  await runMigrations();

  const httpServer = createHttpServer();
  const io = createSocketServer(httpServer);
  const toggleService = new ToggleService();

  const mqttClient = startMqttClient(async (_topic, payload) => {
    const reads = parseRfidMessage(payload);
    if (reads.length === 0) {
      logger.warn('RFID message ignored: no readable entries');
      return;
    }

    for (const read of reads) {
      const result = await toggleService.processRead(read);
      io.emit('reading:new', result.reading);
      io.emit('dashboard:summary', result.summary);
      if (result.inventoryDelta) {
        io.emit('inventory:delta', result.inventoryDelta);
      }
    }
  });

  httpServer.listen(config.app.port, () => {
    logger.info('rfid_demo_dashboard started', {
      port: config.app.port,
      mqttTopic: config.mqtt.topic,
      debounceMs: config.business.debounceMs
    });
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutdown requested');
    mqttClient.end(true);
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    shutdown().catch((error) => {
      logger.error('Shutdown failed', { err: String(error) });
      process.exit(1);
    });
  });

  process.on('SIGTERM', () => {
    shutdown().catch((error) => {
      logger.error('Shutdown failed', { err: String(error) });
      process.exit(1);
    });
  });
};

start().catch((error) => {
  logger.error('Failed to start service', { err: String(error) });
  process.exit(1);
});
