import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const startMqttClient = (
  onMessage: (topic: string, payload: Buffer) => Promise<void>
): MqttClient => {
  const clientId = `${config.mqtt.clientIdPrefix}${Math.random().toString(16).slice(2, 10)}`;
  const url = `mqtt://${config.mqtt.host}:${config.mqtt.port}`;
  const options: IClientOptions = {
    username: config.mqtt.username,
    password: config.mqtt.password,
    keepalive: config.mqtt.keepalive,
    reconnectPeriod: config.mqtt.reconnectMs,
    protocolVersion: config.mqtt.protocolVersion,
    clientId,
    clean: true
  };

  const client = mqtt.connect(url, options);

  client.on('connect', () => {
    logger.info('Connected to MQTT broker', { clientId, topic: config.mqtt.topic });
    client.subscribe(config.mqtt.topic, { qos: config.mqtt.qos }, (error) => {
      if (error) {
        logger.error('Failed to subscribe MQTT topic', { err: String(error) });
        return;
      }
      logger.info('MQTT subscription active', { topic: config.mqtt.topic, qos: config.mqtt.qos });
    });
  });

  client.on('message', (topic, payload) => {
    onMessage(topic, payload).catch((error) => {
      logger.error('Unhandled message processing error', { topic, err: String(error) });
    });
  });

  client.on('reconnect', () => {
    logger.warn('MQTT reconnecting');
  });

  client.on('error', (error) => {
    logger.error('MQTT error', { err: String(error) });
  });

  return client;
};
