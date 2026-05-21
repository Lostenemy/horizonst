import mqtt, { MqttClient } from 'mqtt';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { parseGatewayPayload } from '../presence/payload-parser';
import { ingestPresenceEvent } from '../presence/presence.service';

type MessageHandler = (topic: string, payload: Buffer) => Promise<void> | void;

let client: MqttClient | null = null;
const handlers = new Set<MessageHandler>();
const MIN_ACCEPTED_TS_MS = Date.parse('2025-01-01T00:00:00.000Z');

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

export function addMqttMessageHandler(handler: MessageHandler): void {
  handlers.add(handler);
}

export function removeMqttMessageHandler(handler: MessageHandler): void {
  handlers.delete(handler);
}

export function mqttPublish(topic: string, payload: Record<string, unknown>): Promise<void> {
  if (!client) throw new Error('mqtt client not initialized');
  return new Promise((resolve, reject) => {
    client!.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
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
    const topics = env.MQTT_SUB_TOPICS.split(',').map((v) => v.trim()).filter(Boolean);
    for (const topic of topics) {
      client!.subscribe(topic, { qos: 1 }, (err) => {
        if (err) logger.error({ err, topic }, 'mqtt subscription error');
      });
    }
    logger.info({ topics }, 'mqtt connected');
  });

  client.on('message', async (topic: string, payload: Buffer) => {
    try {
      if (topic.endsWith('/publish')) {
        let asJson: unknown = null;
        try { asJson = JSON.parse(payload.toString('utf8')); } catch { asJson = null; }
        if (!isGatewayCommandReply(asJson)) {
          const receivedAt = new Date();
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

    for (const handler of handlers) {
      try {
        await handler(topic, payload);
      } catch (err) {
        logger.error({ err, topic }, 'mqtt handler failed');
      }
    }
  });

  client.on('error', (err) => logger.error({ err }, 'mqtt client error'));
  client.on('reconnect', () => logger.warn('mqtt reconnecting'));
}
