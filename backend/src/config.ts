import dotenv from 'dotenv';

dotenv.config();

const parseNumber = (value: string | undefined, defaultValue: number): number => {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
};

const parseProtocolId = (value: string | undefined): 'MQTT' | 'MQIsdp' => {
  return value === 'MQIsdp' ? 'MQIsdp' : 'MQTT';
};

const parseProtocolVersion = (value: string | undefined): 3 | 4 => {
  const parsed = Number(value);
  if (parsed === 3) {
    return parsed;
  }
  return 4;
};

interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface MqttConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  keepalive: number;
  reconnectPeriod: number;
  protocolId: 'MQTT' | 'MQIsdp';
  protocolVersion: 3 | 4;
  clean: boolean;
  connectTimeout: number;
  clientPrefix: string;
  persistenceMode: 'app' | 'emqx';
}

interface AppConfig {
  port: number;
  host: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  database: DatabaseConfig;
  mqtt: MqttConfig;
  emqx: EmqxManagementConfig;
}

interface EmqxManagementConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  ssl: boolean;
  maxRetries: number;
  retryIntervalMs: number;
}

export const config: AppConfig = {
  port: parseNumber(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'super-secret-horizonst',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  database: {
    host: process.env.DB_HOST || 'postgres',
    port: parseNumber(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || 'horizonst',
    password: process.env.DB_PASSWORD || 'horizonst',
    database: process.env.DB_NAME || 'horizonst'
  },
  mqtt: {
    host: process.env.MQTT_HOST || 'emqx',
    port: parseNumber(process.env.MQTT_PORT, 1883),
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    keepalive: parseNumber(process.env.MQTT_KEEPALIVE, 60),
    reconnectPeriod: parseNumber(process.env.MQTT_RECONNECT_PERIOD, 1000),
    protocolId: parseProtocolId(process.env.MQTT_PROTOCOL_ID),
    protocolVersion: parseProtocolVersion(process.env.MQTT_PROTOCOL_VERSION),
    clean: parseBoolean(process.env.MQTT_CLEAN, true),
    connectTimeout: parseNumber(process.env.MQTT_CONNECT_TIMEOUT, 10000),
    clientPrefix: process.env.MQTT_CLIENT_PREFIX || 'acces_control_server_',
    persistenceMode: process.env.MQTT_PERSISTENCE_MODE === 'emqx' ? 'emqx' : 'app'
  },
  emqx: {
    host: process.env.EMQX_MGMT_HOST || process.env.MQTT_HOST || 'emqx',
    port: parseNumber(process.env.EMQX_MGMT_PORT, 18083),
    username: process.env.EMQX_MGMT_USERNAME || 'admin',
    password: process.env.EMQX_MGMT_PASSWORD || '20025@BLELoRa',
    ssl: parseBoolean(process.env.EMQX_MGMT_SSL, false),
    maxRetries: Math.max(1, parseNumber(process.env.EMQX_MGMT_MAX_RETRIES, 10)),
    retryIntervalMs: Math.max(500, parseNumber(process.env.EMQX_MGMT_RETRY_INTERVAL_MS, 3000))
  }
};
