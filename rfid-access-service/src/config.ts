import dotenv from 'dotenv';

import type { DirectoryConfig, LookupStrategy, MacDniMap } from './types.js';

dotenv.config();

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const parsePort = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const normalizeBasePath = (value: string | undefined): string => {
  if (!value) {
    return '/';
  }

  let normalized = value.trim();
  if (normalized === '') {
    return '/';
  }

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.replace(/\/+$/, '');
  }

  return normalized;
};

const parseNonNegativeInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const parseProtocolVersion = (value: string | undefined, fallback: 3 | 4 | 5): 3 | 4 | 5 => {
  if (!value) {
    return fallback;
  }

  const normalized = Number.parseInt(value, 10) as 3 | 4 | 5;
  if (normalized === 3 || normalized === 4 || normalized === 5) {
    return normalized;
  }

  return fallback;
};

const parseLookupStrategy = (value: string | undefined, fallback: LookupStrategy): LookupStrategy => {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'on-demand' || normalized === 'on_demand') {
    return 'on-demand';
  }

  if (normalized === 'eager' || normalized === 'preload') {
    return 'eager';
  }

  return fallback;
};

const parseMacDniMap = (value: string | undefined): MacDniMap => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as MacDniMap;
    return Object.fromEntries(
      Object.entries(parsed).map(([mac, dni]) => [mac.trim().toLowerCase(), dni.trim()])
    );
  } catch (error) {
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [mac, dni] = entry.split('=');
        return [mac.trim().toLowerCase(), (dni || '').trim()];
      })
      .filter(([mac, dni]) => mac && dni) as [string, string][];

    return Object.fromEntries(entries);
  }
};

const parseTopicTemplate = (template: string, mac: string): string => {
  return template.replace('{mac}', mac);
};

const buildDirectoryConfig = (): DirectoryConfig => {
  const inline = parseMacDniMap(process.env.RFID_MAC_DNI_MAP);
  const filePath = process.env.RFID_MAC_DNI_FILE;
  const remoteUrl = process.env.RFID_MAC_DNI_DIRECTORY_URL;

  const remote = remoteUrl
    ? {
        url: remoteUrl,
        apiKey: process.env.RFID_MAC_DNI_DIRECTORY_API_KEY,
        timeoutMs: parsePort(process.env.RFID_MAC_DNI_DIRECTORY_TIMEOUT, 5000)
      }
    : null;

  const lookupStrategy = remote
    ? parseLookupStrategy(process.env.RFID_MAC_DNI_LOOKUP_STRATEGY, 'eager')
    : 'eager';

  const defaultRefresh = filePath || (remote && lookupStrategy === 'eager') ? 300000 : 0;

  return {
    inline: Object.keys(inline).length > 0 ? inline : undefined,
    filePath,
    remote,
    refreshIntervalMs: parseNonNegativeInt(process.env.RFID_MAC_DNI_REFRESH_MS, defaultRefresh),
    lookupStrategy
  };
};

export const config = {
  logLevel: (process.env.LOG_LEVEL as LogLevel) || 'info',
  db: {
    host: process.env.RFID_DB_HOST || 'postgres',
    port: parsePort(process.env.RFID_DB_PORT, 5432),
    user: process.env.RFID_DB_USER || 'horizonst',
    password: process.env.RFID_DB_PASSWORD || 'horizonst',
    database: process.env.RFID_DB_NAME || 'rfid_access',
    adminDatabase: process.env.RFID_DB_ADMIN_DB || 'postgres',
    ssl: parseBoolean(process.env.RFID_DB_SSL, false)
  },
  mqtt: {
    host: process.env.MQTT_HOST || 'emqx',
    port: parsePort(process.env.MQTT_PORT, 1883),
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    clientIdPrefix: process.env.MQTT_CLIENT_PREFIX || 'rfid_access_',
    keepalive: parsePort(process.env.MQTT_KEEPALIVE, 60),
    reconnectPeriod: parsePort(process.env.MQTT_RECONNECT_PERIOD, 1000),
    clean: parseBoolean(process.env.MQTT_CLEAN, true),
    protocolVersion: parseProtocolVersion(process.env.MQTT_PROTOCOL_VERSION, 5)
  },
  ecoordina: {
    url: process.env.ECOORDINA_API_URL || 'https://ws.e-coordina.com/1.4',
    user: process.env.ECOORDINA_API_USER || 'webservice',
    token: process.env.ECOORDINA_API_TOKEN || '',
    action: process.env.ECOORDINA_API_ACTION || 'acceso.permitido_data',
    actionType: process.env.ECOORDINA_API_ACTION_TYPE || 'do',
    instance: process.env.ECOORDINA_API_INSTANCE || 'elecnor',
    inputFormat: process.env.ECOORDINA_API_IN || 'json',
    outputFormat: process.env.ECOORDINA_API_OUT || 'json',
    timeoutMs: parsePort(process.env.ECOORDINA_API_TIMEOUT, 7000)
  },
  subscriptions: {
    topic: process.env.RFID_READER_TOPIC || 'rfid/readers/+/scan',
    qos: Number.parseInt(process.env.RFID_READER_QOS || '1', 10)
  },
  directory: buildDirectoryConfig(),
  authApi: {
    url: process.env.RFID_AUTH_API_URL || 'http://backend:3000/api/access/validate',
    timeoutMs: parsePort(process.env.RFID_AUTH_API_TIMEOUT, 5000),
    apiKey: process.env.RFID_AUTH_API_KEY
  },
  readerControl: {
    baseUrl: process.env.RFID_READER_CONTROLLER_BASE_URL || '',
    deviceId: process.env.RFID_READER_DEVICE_ID || '',
    timeoutMs: parsePort(process.env.RFID_READER_CONTROLLER_TIMEOUT, 5000),
    enabled: parseBoolean(process.env.RFID_READER_CONTROLLER_ENABLED, true)
  },
  publishing: {
    qos: Number.parseInt(process.env.RFID_COMMAND_QOS || '1', 10),
    retain: parseBoolean(process.env.RFID_COMMAND_RETAIN, false),
    greenTemplate: process.env.RFID_GREEN_TOPIC_TEMPLATE || 'rfid/{mac}/actuators/green',
    redTemplate: process.env.RFID_RED_TOPIC_TEMPLATE || 'rfid/{mac}/actuators/red',
    alarmTemplate: process.env.RFID_ALARM_TOPIC_TEMPLATE || 'rfid/{mac}/actuators/alarm',
    payloadFormat: process.env.RFID_COMMAND_PAYLOAD_FORMAT || 'json'
  },
  webInterface: {
    enabled: parseBoolean(process.env.RFID_WEB_ENABLED, false),
    port: parsePort(process.env.HTTP_PORT ?? process.env.RFID_WEB_PORT, 3001),
    basePath: normalizeBasePath(process.env.BASE_PATH),
    sessionSecret: process.env.RFID_WEB_SESSION_SECRET || 'rfid-access-secret',
    username: process.env.RFID_WEB_USERNAME || 'admin',
    password: process.env.RFID_WEB_PASSWORD || 'admin',
    historySize: Math.max(1, parseNonNegativeInt(process.env.RFID_WEB_HISTORY_SIZE, 50))
  },
  publishTopicsForMac(mac: string) {
    const normalizedMac = mac.trim().toLowerCase();
    return {
      green: parseTopicTemplate(this.publishing.greenTemplate, normalizedMac),
      red: parseTopicTemplate(this.publishing.redTemplate, normalizedMac),
      alarm: parseTopicTemplate(this.publishing.alarmTemplate, normalizedMac)
    };
  }
};

export type TopicsForMac = ReturnType<typeof config.publishTopicsForMac>;
