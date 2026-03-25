import { env } from './config/env';
import { runMigrations } from './db/migrate';
import { buildApp } from './app';
import { startMqttConsumer } from './modules/mqtt/mqtt.service';
import { startSyncLoop } from './modules/sync/sync.service';
import { startGatewayReplyListener } from './modules/tag-control/infrastructure/gateway-reply-listener';
import { startComplianceRuleLoop, startPresenceTimeoutLoop } from './modules/compliance/compliance.service';
import { logger } from './utils/logger';

async function bootstrap() {
  await runMigrations();
  startMqttConsumer();
  startGatewayReplyListener();
  startSyncLoop();
  startComplianceRuleLoop();
  startPresenceTimeoutLoop();

  const app = buildApp();
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'cold compliance service started');
  });
}

bootstrap().catch((error) => {
  logger.error({ error }, 'failed to bootstrap');
  process.exit(1);
});
