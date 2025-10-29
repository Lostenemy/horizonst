import mqtt, { IClientOptions, IClientPublishOptions, MqttClient } from 'mqtt';
import axios, { AxiosError } from 'axios';
import { config } from './config.js';
import { DniDirectory } from './dniDirectory.js';
import { logger } from './logger.js';
import { normalizeMac, safeJsonParse } from './utils.js';
import type { AuthApiResponse, RfidScanMessage } from './types.js';

const buildTopicMatcher = (pattern: string): { regex: RegExp; macGroupIndex: number | null } => {
  const escapeRegex = (segment: string): string => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let captureGroup = 0;
  let macGroupIndex: number | null = null;

  const regexSource = pattern
    .split('/')
    .map((segment) => {
      if (segment === '+') {
        captureGroup += 1;
        if (macGroupIndex === null) {
          macGroupIndex = captureGroup;
        }
        return '([^/]+)';
      }

      if (segment === '#') {
        captureGroup += 1;
        if (macGroupIndex === null) {
          macGroupIndex = captureGroup;
        }
        return '(.+)';
      }

      return escapeRegex(segment);
    })
    .join('/');

  return {
    regex: new RegExp(`^${regexSource}$`),
    macGroupIndex
  };
};

const topicMatcher = buildTopicMatcher(config.subscriptions.topic);

const axiosInstance = axios.create({
  timeout: config.authApi.timeoutMs
});

if (config.authApi.apiKey) {
  axiosInstance.defaults.headers.common.Authorization = `Bearer ${config.authApi.apiKey}`;
}

type AccessDecision = 'GRANTED' | 'DENIED';

interface PublishContext {
  client: MqttClient;
  mac: string;
  cardId: string;
  dni: string | null;
  reason?: string;
}

const publishCommand = async (
  client: MqttClient,
  topic: string,
  decision: AccessDecision,
  context: PublishContext,
  extra?: Record<string, unknown>
): Promise<void> => {
  const payloadBase = {
    decision,
    cardId: context.cardId,
    dni: context.dni,
    timestamp: new Date().toISOString(),
    reason: context.reason,
    ...extra
  };

  let payload: string;
  if (config.publishing.payloadFormat === 'text') {
    payload = decision;
  } else {
    payload = JSON.stringify(payloadBase);
  }

  const options: IClientPublishOptions = {
    qos: config.publishing.qos,
    retain: config.publishing.retain
  };

  await new Promise<void>((resolve, reject) => {
    client.publish(topic, payload, options, (error?: Error) => {
      if (error) {
        return reject(error);
      }
      return resolve();
    });
  });

  logger.info({ topic, decision, cardId: context.cardId, dni: context.dni }, 'Published actuator command');
};

const handleAccessDecision = async (
  client: MqttClient,
  decision: AccessDecision,
  mac: string,
  cardId: string,
  dni: string | null,
  reason?: string
): Promise<void> => {
  const topics = config.publishTopicsForMac(mac);
  const publishContext: PublishContext = { client, mac, cardId, dni, reason };

  if (decision === 'GRANTED') {
    await publishCommand(client, topics.green, decision, publishContext, { signal: 'GREEN' });
  } else {
    await Promise.all([
      publishCommand(client, topics.red, decision, publishContext, { signal: 'RED' }),
      publishCommand(client, topics.alarm, decision, publishContext, { signal: 'ALARM' })
    ]);
  }
};

const determineAcceptance = (responseData: Partial<AuthApiResponse> | undefined, _status: number): AccessDecision => {
  if (responseData && typeof responseData.accepted === 'boolean') {
    return responseData.accepted ? 'GRANTED' : 'DENIED';
  }

  const statusField = (responseData?.status || responseData?.result || responseData?.decision) as string | undefined;
  if (statusField) {
    const normalized = statusField.toString().trim().toUpperCase();
    if (['ACCEPTED', 'GRANTED', 'ALLOW', 'ALLOWED'].includes(normalized)) {
      return 'GRANTED';
    }
    if (['REJECTED', 'DENIED', 'BLOCKED', 'FORBIDDEN'].includes(normalized)) {
      return 'DENIED';
    }
  }

  return 'DENIED';
};

const extractReason = (responseData: Partial<AuthApiResponse> | undefined): string | undefined => {
  return (
    responseData?.reason ||
    (typeof responseData?.message === 'string' ? responseData?.message : undefined) ||
    (typeof responseData?.details === 'string' ? responseData?.details : undefined)
  );
};

const dniDirectory = new DniDirectory(config.directory);

const processMessage = async (client: MqttClient, topic: string, payloadBuffer: Buffer): Promise<void> => {
  const messageString = payloadBuffer.toString('utf-8').trim();
  const parsed = safeJsonParse<RfidScanMessage>(messageString);

  const cardId = parsed?.cardId || messageString;
  const macFromPayload = normalizeMac(parsed?.readerMac);
  const macFromTopic = topicMatcher.macGroupIndex
    ? normalizeMac(topic.match(topicMatcher.regex)?.[topicMatcher.macGroupIndex] ?? undefined)
    : null;

  const mac = macFromPayload || macFromTopic;

  if (!cardId) {
    logger.warn({ topic }, 'RFID message without card identifier');
    return;
  }

  if (!mac) {
    logger.warn({ topic, cardId }, 'RFID message without MAC information');
    return;
  }

  const dni = await dniDirectory.getDni(mac);

  if (!dni) {
    logger.warn({ mac, cardId }, 'No DNI mapping for reader MAC');
    await handleAccessDecision(client, 'DENIED', mac, cardId, null, 'UNKNOWN_DNI');
    return;
  }

  try {
    logger.info({ mac, cardId, dni }, 'Requesting access validation');

    const response = await axiosInstance.post<AuthApiResponse>(config.authApi.url, {
      dni,
      cardId,
      readerMac: mac,
      timestamp: parsed?.timestamp || new Date().toISOString(),
      additional: parsed?.additional
    });

    const decision = determineAcceptance(response.data, response.status);
    const reason = extractReason(response.data);

    await handleAccessDecision(client, decision, mac, cardId, dni, reason);
  } catch (error) {
    const axiosError = error as AxiosError;
    logger.error(
      {
        err: axiosError,
        mac,
        cardId,
        status: axiosError.response?.status,
        data: axiosError.response?.data
      },
      'Failed to validate access with external API'
    );

    await handleAccessDecision(client, 'DENIED', mac, cardId, dni, 'API_ERROR');
  }
};

const start = async (): Promise<void> => {
  await dniDirectory.initialize();
  const clientId = `${config.mqtt.clientIdPrefix}${Math.random().toString(16).slice(2, 10)}`;
  const url = `mqtt://${config.mqtt.host}:${config.mqtt.port}`;
  const options: IClientOptions = {
    username: config.mqtt.username,
    password: config.mqtt.password,
    keepalive: config.mqtt.keepalive,
    reconnectPeriod: config.mqtt.reconnectPeriod,
    clean: config.mqtt.clean,
    clientId,
    protocolVersion: config.mqtt.protocolVersion
  };

  const client = mqtt.connect(url, options);

  client.on('connect', () => {
    logger.info({ clientId }, 'Connected to MQTT broker');
    client.subscribe(config.subscriptions.topic, { qos: config.subscriptions.qos }, (error, granted) => {
      if (error) {
        logger.error({ err: error }, 'Failed to subscribe to RFID topic');
        return;
      }
      logger.info({ granted }, 'Subscribed to RFID topic');
    });
  });

  client.on('error', (error) => {
    logger.error({ err: error }, 'MQTT client error');
  });

  client.on('message', (topic, message) => {
    processMessage(client, topic, message).catch((error) => {
      logger.error({ err: error, topic }, 'Unhandled error processing RFID message');
    });
  });

  const gracefulShutdown = (): void => {
    logger.info('Shutting down RFID access service');
    dniDirectory.stop();
    client.end(false, {}, () => {
      process.exit(0);
    });
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
};

start().catch((error) => {
  logger.error({ err: error }, 'Failed to start RFID access service');
  process.exit(1);
});
