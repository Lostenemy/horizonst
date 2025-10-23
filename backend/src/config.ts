import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'super-secret-horizonst',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  database: {
    host: process.env.DB_HOST || 'postgres',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
    user: process.env.DB_USER || 'horizonst',
    password: process.env.DB_PASSWORD || 'horizonst',
    database: process.env.DB_NAME || 'horizonst'
  },
  mqtt: {
    host: process.env.MQTT_HOST || 'horizonst.com.es',
    port: process.env.MQTT_PORT ? parseInt(process.env.MQTT_PORT, 10) : 1887,
    username: process.env.MQTT_USER || 'Horizon@user2024',
    password: process.env.MQTT_PASS || 'Chanel_horizon@2024',
    keepalive: process.env.MQTT_KEEPALIVE ? parseInt(process.env.MQTT_KEEPALIVE, 10) : 60,
    reconnectPeriod: process.env.MQTT_RECONNECT_PERIOD ? parseInt(process.env.MQTT_RECONNECT_PERIOD, 10) : 1000,
    protocolId: process.env.MQTT_PROTOCOL_ID || 'MQIsdp',
    protocolVersion: process.env.MQTT_PROTOCOL_VERSION ? parseInt(process.env.MQTT_PROTOCOL_VERSION, 10) : 3,
    clean: process.env.MQTT_CLEAN ? process.env.MQTT_CLEAN === 'true' : true,
    encoding: process.env.MQTT_ENCODING || 'utf8',
    connectTimeout: process.env.MQTT_CONNECT_TIMEOUT ? parseInt(process.env.MQTT_CONNECT_TIMEOUT, 10) : 10000,
    clientPrefix: process.env.MQTT_CLIENT_PREFIX || 'acces_control_server_'
  }
};
