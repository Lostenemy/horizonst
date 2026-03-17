import dotenv from 'dotenv';
import type { LogLevel } from './types.js';

dotenv.config();

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const parseMqttProtocolVersion = (value: string | undefined): 3 | 4 | 5 => {
  const parsed = parseNumber(value, 4);
  if (parsed === 3 || parsed === 4 || parsed === 5) return parsed;
  return 4;
};


const parseReaderAliases = (value: string | undefined): Record<string, string> => {
  const defaults: Record<string, string> = {
    'demo-reader-01': 'Lector-Puerta-Almacén-01',
    'demo-reader-02': 'Lector-Acceso-360P',
    'demo-reader-03': 'Lector-Zona-Carga-A'
  };

  if (!value?.trim()) return defaults;

  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    const normalized = Object.entries(parsed).reduce<Record<string, string>>((acc, [key, label]) => {
      if (!key || typeof label !== 'string' || !label.trim()) return acc;
      acc[key.trim().toLowerCase()] = label.trim();
      return acc;
    }, {});

    return { ...defaults, ...normalized };
  } catch {
    return defaults;
  }
};

export const config = {
  app: {
    port: parseNumber(process.env.RFID_DEMO_PORT, 3200),
    logLevel: (process.env.RFID_DEMO_LOG_LEVEL as LogLevel | undefined) || 'info',
    corsOrigin: process.env.RFID_DEMO_CORS_ORIGIN || '*'
  },
  mqtt: {
    host: process.env.RFID_DEMO_MQTT_HOST || 'vernemq',
    port: parseNumber(process.env.RFID_DEMO_MQTT_PORT, 1883),
    username: process.env.RFID_DEMO_MQTT_USER,
    password: process.env.RFID_DEMO_MQTT_PASS,
    clientId: process.env.RFID_DEMO_MQTT_CLIENT_ID || 'rfid_demo_dashboard',
    topic: process.env.RFID_DEMO_MQTT_TOPIC || 'devices/RF1',
    qos: parseNumber(process.env.RFID_DEMO_MQTT_QOS, 1) as 0 | 1 | 2,
    protocolVersion: parseMqttProtocolVersion(process.env.RFID_DEMO_MQTT_PROTOCOL_VERSION),
    keepalive: parseNumber(process.env.RFID_DEMO_MQTT_KEEPALIVE, 60),
    reconnectMs: parseNumber(process.env.RFID_DEMO_MQTT_RECONNECT_MS, 1000),
    cleanSession: parseBoolean(process.env.RFID_DEMO_MQTT_CLEAN, true),
    connectTimeoutMs: parseNumber(process.env.RFID_DEMO_MQTT_CONNECT_TIMEOUT_MS, 30000),
    readerAliases: parseReaderAliases(process.env.RFID_DEMO_READER_ALIASES)
  },
  db: {
    host: process.env.RFID_DEMO_DB_HOST || 'postgres',
    port: parseNumber(process.env.RFID_DEMO_DB_PORT, 5432),
    user: process.env.RFID_DEMO_DB_USER || 'horizonst',
    password: process.env.RFID_DEMO_DB_PASSWORD || 'horizonst',
    database: process.env.RFID_DEMO_DB_NAME || 'rfid_demo',
    ssl: parseBoolean(process.env.RFID_DEMO_DB_SSL, false)
  },
  business: {
    debounceMs: Math.max(0, parseNumber(process.env.RFID_DEMO_DEBOUNCE_MS, 20000)),
    cycleResetAfterMs: Math.max(0, parseNumber(process.env.RFID_DEMO_CYCLE_RESET_AFTER_MS, 300000)),
    recentEventsLimit: Math.max(1, parseNumber(process.env.RFID_DEMO_RECENT_EVENTS_LIMIT, 100)),
    activeLimit: Math.max(1, parseNumber(process.env.RFID_DEMO_ACTIVE_LIMIT, 500))
  }
};
