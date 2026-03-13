import mqtt from 'mqtt';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { parseGatewayPayload } from '../presence/payload-parser';
import { ingestPresenceEvent } from '../presence/presence.service';

export function startMqttConsumer(): void {
  const client = mqtt.connect(env.MQTT_URL, {
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD,
    clientId: env.MQTT_CLIENT_ID,
    reconnectPeriod: 3000,
    clean: true
  });

  client.on('connect', () => {
    const topics = env.MQTT_SUB_TOPICS.split(',').map((v) => v.trim()).filter(Boolean);
    for (const topic of topics) {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) logger.error({ err, topic }, 'mqtt subscription error');
      });
    }
    logger.info({ topics }, 'mqtt connected');
  });

  client.on('message', async (topic, payload) => {
    try {
      const events = parseGatewayPayload(topic, payload);
      for (const event of events) {
        await ingestPresenceEvent(event);
      }
    } catch (err) {
      logger.error({ err, topic }, 'failed processing mqtt payload');
    }
  });

  client.on('error', (err) => logger.error({ err }, 'mqtt client error'));
  client.on('reconnect', () => logger.warn('mqtt reconnecting'));
}
