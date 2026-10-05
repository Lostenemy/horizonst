import { env } from './config/env';
import { runMigrations } from './db/migrate';
import { buildApp } from './app';
import { startMqttConsumer } from './modules/mqtt/mqtt.service';
import { startSyncLoop } from './modules/sync/sync.service';
import { startComplianceRuleLoop, startPresenceTimeoutLoop } from './modules/compliance/compliance.service';
import { startPresenceGraceLoop } from './modules/presence/presence-state.service';
import { logger } from './utils/logger';
import { startPresenceMaintenanceLoop } from './modules/maintenance/maintenance.service';
import { startCloseEffectsLoop } from './modules/compliance/presence-close-effects';
import { startPhysicalAlarmOutboxLoop } from './modules/alerts/physical-alarm-outbox';

async function bootstrap() {
  await runMigrations();
  startMqttConsumer();
  startSyncLoop();
  startComplianceRuleLoop();
  startPresenceTimeoutLoop();
  startPresenceGraceLoop();
  startPresenceMaintenanceLoop();
  startCloseEffectsLoop();
  startPhysicalAlarmOutboxLoop();

  const app = buildApp();
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'cold compliance service started');
  });
}

bootstrap().catch((error) => {
  logger.error({ error }, 'failed to bootstrap');
  process.exit(1);
});
