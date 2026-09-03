import mqtt, { MqttClient } from 'mqtt';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { parseGatewayPayload, parseManualEmergencyPayload } from '../presence/payload-parser';
import { ingestPresenceEvent } from '../presence/presence.service';
import { processManualEmergency } from '../alerts/manual-emergency.service';
import {
  HardwareGateway,
  listHardwareGateways,
  normalizeHorneoGatewayMac
} from '../gateways/hardware-manager.client';

let client: MqttClient | null = null;
const MIN_ACCEPTED_TS_MS = Date.parse('2025-01-01T00:00:00.000Z');
const subscribedTopics = new Set<string>();
let topicRefreshTimer: NodeJS.Timeout | null = null;

export function buildCentralGatewayPublishTopics(gateways: HardwareGateway[]): string[] {
  return [...new Set(gateways
    .filter((gateway) => gateway.active)
    .map((gateway) => normalizeHorneoGatewayMac(gateway.mac_address))
    .filter((mac): mac is string => mac !== null)
    .map((mac) => `gw/${mac}/publish`))].sort();
}

function configuredExactTopics(): string[] {
  return [...new Set(env.MQTT_SUB_TOPICS.split(',')
    .map((value) => value.trim())
    .filter((topic) => topic.length > 0 && !topic.includes('+') && !topic.includes('#')))];
}

async function desiredSubscriptionTopics(): Promise<string[] | null> {
  if (!env.HARDWARE_MANAGER_ENABLED) return configuredExactTopics();
  const inventory = await listHardwareGateways();
  if (inventory.kind !== 'found') {
    logger.warn({ reason: inventory.kind === 'unavailable' ? inventory.error : inventory.kind }, 'unable to refresh exact MQTT gateway topics');
    return null;
  }
  return buildCentralGatewayPublishTopics(inventory.value);
}

async function refreshMqttSubscriptions(): Promise<void> {
  if (!client?.connected) return;
  const desired = await desiredSubscriptionTopics();
  if (desired === null) return;
  const desiredSet = new Set(desired);
  const removed = [...subscribedTopics].filter((topic) => !desiredSet.has(topic));
  const added = desired.filter((topic) => !subscribedTopics.has(topic));
  if (removed.length) await new Promise<void>((resolve, reject) => client!.unsubscribe(removed, (error) => error ? reject(error) : resolve()));
  if (added.length) await new Promise<void>((resolve, reject) => client!.subscribe(added, { qos: 1 }, (error) => error ? reject(error) : resolve()));
  removed.forEach((topic) => subscribedTopics.delete(topic));
  added.forEach((topic) => subscribedTopics.add(topic));
  logger.info({ topics: [...subscribedTopics], added, removed }, 'mqtt exact gateway subscriptions refreshed');
}

function parsePayloadTimestampMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value > 1e9 ? value * 1000 : value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) return numeric > 1e12 ? numeric : numeric > 1e9 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function isGatewayCommandReply(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return typeof p.msg_id === 'number' && typeof p.result_code === 'number';
}

export function startMqttConsumer(): void {
  client = mqtt.connect(env.MQTT_URL, {
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD,
    clientId: env.MQTT_CLIENT_ID,
    reconnectPeriod: 3000,
    clean: true
  });

  client.on('connect', () => {
    // clean=true means broker subscriptions do not survive reconnects.
    subscribedTopics.clear();
    void refreshMqttSubscriptions().catch((err) => logger.error({ err }, 'mqtt subscription refresh error'));
    if (!topicRefreshTimer) {
      topicRefreshTimer = setInterval(() => {
        void refreshMqttSubscriptions().catch((err) => logger.error({ err }, 'mqtt subscription refresh error'));
      }, env.HARDWARE_MANAGER_MQTT_TOPIC_REFRESH_MS);
      topicRefreshTimer.unref();
    }
    logger.info('mqtt connected; refreshing company-scoped exact gateway topics');
  });

  client.on('message', async (topic: string, payload: Buffer) => {
    try {
      if (topic.endsWith('/publish')) {
        let asJson: unknown = null;
        try { asJson = JSON.parse(payload.toString('utf8')); } catch { asJson = null; }
        if (!isGatewayCommandReply(asJson)) {
          const receivedAt = new Date();
          const manualEmergencies = parseManualEmergencyPayload(topic, payload, receivedAt);
          for (const emergency of manualEmergencies) {
            await processManualEmergency(emergency);
          }
          const events = parseGatewayPayload(topic, payload, receivedAt);
          if (!events.length) {
            logger.debug({ topic }, 'mqtt payload without detectable tag identifiers, skipping');
          }
          for (const event of events) {
            if (event.payloadTimestamp !== null && event.payloadTimestamp !== undefined) {
              const payloadTsMs = parsePayloadTimestampMs(event.payloadTimestamp);
              const suspicious = payloadTsMs === null || payloadTsMs < MIN_ACCEPTED_TS_MS || payloadTsMs > (receivedAt.getTime() + 5 * 60 * 1000);
              logger[suspicious ? 'warn' : 'debug']({
                topic,
                gatewayMac: event.gatewayMac,
                tagId: event.tagId,
                payloadTimestamp: event.payloadTimestamp,
                receivedAt: event.timestamp
              }, 'payload timestamp ignored: server receivedAt is authoritative');
            }
            await ingestPresenceEvent(event);
          }
        }
      }
    } catch (err) {
      logger.error({ err, topic }, 'failed processing mqtt payload as presence');
    }
  });

  client.on('error', (err) => logger.error({ err }, 'mqtt client error'));
  client.on('reconnect', () => logger.warn('mqtt reconnecting'));
}
