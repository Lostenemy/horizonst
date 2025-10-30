import mqtt, {
  type IClientOptions,
  type IClientPublishOptions,
  type ISubscriptionGrant,
  type MqttClient
} from 'mqtt';
import axios, { AxiosError } from 'axios';
import { config } from './config.js';
import { DniDirectory } from './dniDirectory.js';
import { logger } from './logger.js';
import { normalizeMac, safeJsonParse } from './utils.js';
import { startWebInterface, type HistoryEvent, type WebInterfaceController } from './webServer.js';
import type {
  AccessDecision,
  AccessEvaluationResult,
  AuthApiResponse,
  PublishedCommand,
  RfidScanMessage,
  SimulationRequest
} from './types.js';

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

type QoS = 0 | 1 | 2;

const parseQoS = (input: unknown, fallback: QoS = 0): QoS => {
  if (input === undefined || input === null) {
    return fallback;
  }

  if (typeof input === 'number') {
    if (input === 0 || input === 1 || input === 2) {
      return input;
    }
    return fallback;
  }

  const parsed = Number.parseInt(String(input), 10);
  if (parsed === 0 || parsed === 1 || parsed === 2) {
    return parsed as QoS;
  }

  return fallback;
};

const subscriptionQoS: QoS = parseQoS(config.subscriptions.qos, 1);
const publishingQoS: QoS = parseQoS(config.publishing.qos, 1);

if (config.authApi.apiKey) {
  axiosInstance.defaults.headers.common.Authorization = `Bearer ${config.authApi.apiKey}`;
}

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
): Promise<PublishedCommand> => {
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
    qos: publishingQoS,
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
  return {
    topic,
    payload,
    qos: options.qos as PublishedCommand['qos'],
    retain: Boolean(options.retain)
  };
};

const handleAccessDecision = async (
  client: MqttClient,
  decision: AccessDecision,
  mac: string,
  cardId: string,
  dni: string | null,
  reason?: string
): Promise<PublishedCommand[]> => {
  const topics = config.publishTopicsForMac(mac);
  const publishContext: PublishContext = { client, mac, cardId, dni, reason };

  if (decision === 'GRANTED') {
    const publication = await publishCommand(client, topics.green, decision, publishContext, {
      signal: 'GREEN'
    });
    return [publication];
  }

  const [redPublication, alarmPublication] = await Promise.all([
    publishCommand(client, topics.red, decision, publishContext, { signal: 'RED' }),
    publishCommand(client, topics.alarm, decision, publishContext, { signal: 'ALARM' })
  ]);

  return [redPublication, alarmPublication];
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

let webInterfaceController: WebInterfaceController | null = null;

interface EvaluationContext extends SimulationRequest {
  source: 'mqtt' | 'web';
}

const evaluateScan = async (
  client: MqttClient,
  context: EvaluationContext
): Promise<AccessEvaluationResult> => {
  const { mac, cardId, timestamp, additional, source } = context;

  const dni = await dniDirectory.getDni(mac);

  if (!dni) {
    logger.warn({ mac, cardId, source }, 'No DNI mapping for reader MAC');
    const publications = await handleAccessDecision(client, 'DENIED', mac, cardId, null, 'UNKNOWN_DNI');
    return { decision: 'DENIED', reason: 'UNKNOWN_DNI', dni: null, publications };
  }

  try {
    logger.info({ mac, cardId, dni, source }, 'Requesting access validation');

    const response = await axiosInstance.post<AuthApiResponse>(config.authApi.url, {
      dni,
      cardId,
      readerMac: mac,
      timestamp: timestamp || new Date().toISOString(),
      additional
    });

    const decision = determineAcceptance(response.data, response.status);
    const reason = extractReason(response.data);
    const publications = await handleAccessDecision(client, decision, mac, cardId, dni, reason);
    return { decision, reason, dni, publications };
  } catch (error) {
    const axiosError = error as AxiosError;
    logger.error(
      {
        err: axiosError,
        mac,
        cardId,
        source,
        status: axiosError.response?.status,
        data: axiosError.response?.data
      },
      'Failed to validate access with external API'
    );

    const publications = await handleAccessDecision(client, 'DENIED', mac, cardId, dni, 'API_ERROR');
    return { decision: 'DENIED', reason: 'API_ERROR', dni, publications };
  }
};

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

  const evaluation = await evaluateScan(client, {
    mac,
    cardId,
    timestamp: parsed?.timestamp,
    additional: parsed?.additional,
    source: 'mqtt'
  });

  logger.info({ mac, cardId, decision: evaluation.decision, dni: evaluation.dni }, 'Processed RFID scan');

  if (webInterfaceController) {
    const event: HistoryEvent = {
      ...evaluation,
      mac,
      cardId,
      timestamp: parsed?.timestamp || new Date().toISOString(),
      source: 'mqtt'
    };
    webInterfaceController.recordEvent(event);
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

  try {
    webInterfaceController = await startWebInterface({
      config: config.webInterface,
      simulateScan: async (payload: SimulationRequest) =>
        evaluateScan(client, { ...payload, source: 'web' })
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start web test interface');
    throw error;
  }

  client.on('connect', () => {
    logger.info({ clientId }, 'Connected to MQTT broker');
    client.subscribe(
      config.subscriptions.topic,
      { qos: subscriptionQoS },
      (error: Error | null, granted?: ISubscriptionGrant[]) => {
        if (error) {
          logger.error({ err: error }, 'Failed to subscribe to RFID topic');
          return;
        }

        if (granted && granted.length > 0) {
          logger.info({ granted }, 'Subscribed to RFID topic');
        } else {
          logger.warn('Subscribed to RFID topic without grant details');
        }
      }
    );
  });

  client.on('error', (error: Error) => {
    logger.error({ err: error }, 'MQTT client error');
  });

  client.on('message', (topic: string, message: Buffer) => {
    processMessage(client, topic, message).catch((error) => {
      logger.error({ err: error, topic }, 'Unhandled error processing RFID message');
    });
  });

  const gracefulShutdown = (): void => {
    logger.info('Shutting down RFID access service');
    dniDirectory.stop();
    if (webInterfaceController) {
      webInterfaceController
        .close()
        .catch((error) => {
          logger.error({ err: error }, 'Error closing web test interface');
        });
    }
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
