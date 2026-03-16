import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const startMqttClient = (
  onMessage: (topic: string, payload: Buffer) => Promise<void>
): MqttClient => {
  const clientId = config.mqtt.clientId;
  const url = `mqtt://${config.mqtt.host}:${config.mqtt.port}`;
  const options: IClientOptions = {
    username: config.mqtt.username,
    password: config.mqtt.password,
    keepalive: config.mqtt.keepalive,
    reconnectPeriod: config.mqtt.reconnectMs,
    protocolVersion: config.mqtt.protocolVersion,
    clientId,
    clean: config.mqtt.cleanSession,
    resubscribe: true,
    connectTimeout: config.mqtt.connectTimeoutMs
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
    logger.warn('MQTT reconnecting', { clientId, reconnectMs: config.mqtt.reconnectMs });
  });

  client.on('close', () => {
    logger.warn('MQTT connection closed', { clientId });
  });

  client.on('offline', () => {
    logger.warn('MQTT client offline', { clientId });
  });

  client.on('error', (error) => {
    const errMessage = String(error);
    logger.error('MQTT error', {
      err: errMessage,
      clientId,
      protocolVersion: config.mqtt.protocolVersion,
      host: config.mqtt.host,
      topic: config.mqtt.topic
    });

    if (errMessage.includes('ECONNRESET')) {
      logger.warn('MQTT connection reset by peer', {
        hint: 'Revisar protocolVersion/clientId duplicado/ACL y cleanSession',
        protocolVersion: config.mqtt.protocolVersion,
        cleanSession: config.mqtt.cleanSession
      });
    }
  });

  return client;
};
