import { env } from './config/env';
import { runMigrations } from './db/migrate';
import { buildApp } from './app';
import { startMqttConsumer } from './modules/mqtt/mqtt.service';
import { startSyncLoop } from './modules/sync/sync.service';
import { logger } from './utils/logger';

async function bootstrap() {
  await runMigrations();
  const app = buildApp();

  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'cold compliance service started');
  });

  startMqttConsumer();
  startSyncLoop();
}

bootstrap().catch((error) => {
  logger.error({ error }, 'failed to bootstrap');
  process.exit(1);
});
