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
    protocolVersion: config.mqtt.protocolVersion,
    clientId,
    clean: config.mqtt.cleanSession,
    resubscribe: false,
    reconnectPeriod: 0,
    connectTimeout: config.mqtt.connectTimeoutMs
  };

  const client = mqtt.connect(url, options);

  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let subscribing = false;
  let subscribed = false;
  let connectionSeq = 0;

  const originalEnd = client.end.bind(client);
  client.end = ((force?: boolean, opts?: unknown, cb?: () => void) => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    return originalEnd(force, opts as never, cb);
  }) as MqttClient['end'];

  const scheduleReconnect = (reason: string, err?: unknown) => {
    if (stopped || reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (stopped) return;
      logger.warn('MQTT reconnecting', {
        reason,
        clientId,
        reconnectMs: config.mqtt.reconnectMs,
        err: err ? String(err) : undefined
      });
      client.reconnect();
    }, config.mqtt.reconnectMs);
  };

  const subscribeForConnection = (seq: number) => {
    if (stopped || subscribing || subscribed || !client.connected) return;

    subscribing = true;
    client.subscribe(config.mqtt.topic, { qos: config.mqtt.qos }, (error) => {
      if (seq !== connectionSeq) return;
      subscribing = false;

      if (error) {
        logger.error('Failed to subscribe MQTT topic', { topic: config.mqtt.topic, err: String(error) });
        subscribed = false;
        scheduleReconnect('subscribe_failed', error);
        return;
      }

      subscribed = true;
      logger.info('MQTT subscription active', { topic: config.mqtt.topic, qos: config.mqtt.qos });
    });
  };

  client.on('connect', () => {
    connectionSeq += 1;
    subscribed = false;
    subscribing = false;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    logger.info('Connected to MQTT broker', {
      clientId,
      topic: config.mqtt.topic,
      cleanSession: config.mqtt.cleanSession,
      protocolVersion: config.mqtt.protocolVersion
    });

    subscribeForConnection(connectionSeq);
  });

  client.on('message', (topic, payload) => {
    onMessage(topic, payload).catch((error) => {
      logger.error('Unhandled message processing error', { topic, err: String(error) });
    });
  });

  client.on('close', () => {
    subscribed = false;
    subscribing = false;
    logger.warn('MQTT connection closed', { clientId });
    scheduleReconnect('close');
  });

  client.on('offline', () => {
    subscribed = false;
    subscribing = false;
    logger.warn('MQTT client offline', { clientId });
    scheduleReconnect('offline');
  });

  client.on('error', (error) => {
    const errMessage = String(error);
    logger.error('MQTT error', {
      err: errMessage,
      clientId,
      protocolVersion: config.mqtt.protocolVersion,
      topic: config.mqtt.topic
    });

    if (errMessage.includes('ECONNRESET')) {
      scheduleReconnect('econnreset', error);
    }
  });

  return client;
};
