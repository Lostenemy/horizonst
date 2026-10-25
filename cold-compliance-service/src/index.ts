import { env } from './config/env';
import { runMigrations } from './db/migrate';
import { buildApp } from './app';
import { startMqttConsumer, stopMqttConsumer } from './modules/mqtt/mqtt.service';
import http from 'node:http';
import { lifecycle } from './lifecycle';
import { databaseLifecycle } from './db/pool';
import { startSyncLoop } from './modules/sync/sync.service';
import { startComplianceRuleLoop, startPresenceTimeoutLoop } from './modules/compliance/compliance.service';
import { startPresenceGraceLoop } from './modules/presence/presence-state.service';
import { logger } from './utils/logger';
import { startPresenceMaintenanceLoop } from './modules/maintenance/maintenance.service';
import { startCloseEffectsLoop } from './modules/compliance/presence-close-effects';
import { startPhysicalAlarmOutboxLoop } from './modules/alerts/physical-alarm-outbox';

const app = buildApp();
const server = http.createServer(app);
lifecycle.install(server, stopMqttConsumer, () => databaseLifecycle.close());

async function bootstrap() {
  await runMigrations();
  if (lifecycle.stopping) return;
  startMqttConsumer();
  startSyncLoop();
  startComplianceRuleLoop();
  startPresenceTimeoutLoop();
  startPresenceGraceLoop();
  startPresenceMaintenanceLoop();
  lifecycle.register('close-effects', startCloseEffectsLoop());
  lifecycle.register('physical-outbox', startPhysicalAlarmOutboxLoop());

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'cold compliance service started');
  });
}

void lifecycle.track(bootstrap()).catch((error) => {
  if (lifecycle.stopping) return;
  logger.error({ error }, 'failed to bootstrap');
  process.exit(1);
});
