import mqtt, { MqttClient } from 'mqtt';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { parseGatewayPayload } from '../presence/payload-parser';
import { ingestPresenceEvent } from '../presence/presence.service';

type MessageHandler = (topic: string, payload: Buffer) => Promise<void> | void;

let client: MqttClient | null = null;
const handlers = new Set<MessageHandler>();

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
        const events = parseGatewayPayload(topic, payload);
        for (const event of events) {
          await ingestPresenceEvent(event);
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
