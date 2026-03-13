import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3100),
  LOG_LEVEL: z.string().default('info'),
  DB_HOST: z.string().default('postgres'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default('horizonst'),
  DB_PASSWORD: z.string().default('horizonst'),
  DB_NAME: z.string().default('cold_compliance'),
  MQTT_URL: z.string().default('mqtt://vernemq:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_CLIENT_ID: z.string().default('cold-compliance-service'),
  MQTT_SUB_TOPICS: z.string().default('gw/+/publish'),
  MQTT_COMMAND_TOPIC_TEMPLATE: z.string().default('gw/{gatewayMac}/subscribe'),
  MAX_CONTINUOUS_MINUTES: z.coerce.number().default(45),
  PRE_ALERT_MINUTES: z.coerce.number().default(40),
  REQUIRED_BREAK_MINUTES: z.coerce.number().default(15),
  MAX_DAILY_MINUTES: z.coerce.number().default(360),
  INCIDENT_GRACE_MINUTES: z.coerce.number().default(2),
  DEAD_MAN_DEFAULT_MINUTES: z.coerce.number().default(3),
  BATTERY_ALERT_THRESHOLD: z.coerce.number().default(20),
  SYNC_BATCH_SIZE: z.coerce.number().default(100),
  TAG_CONTROL_ENABLED: z.coerce.boolean().default(true),
  TAG_CONTROL_DEFAULT_TIMEOUT_MS: z.coerce.number().default(8000),
  TAG_CONTROL_MAX_RETRIES: z.coerce.number().default(2),
  TAG_CONTROL_MSG_ID_START: z.coerce.number().default(1100),
  TAG_CONTROL_REQUIRE_REPLY: z.coerce.boolean().default(true),
  TAG_CONTROL_DEDUP_WINDOW_MS: z.coerce.number().default(10000),
  TAG_CONTROL_GATEWAY_STRATEGY: z.enum(['last_seen', 'camera_assigned', 'hybrid']).default('hybrid'),
  MAIL_ENABLED: z.coerce.boolean().default(true),
  MAIL_HOST: z.string().default('mail'),
  MAIL_PORT: z.coerce.number().default(465),
  MAIL_SECURE: z.coerce.boolean().default(true),
  MAIL_USER: z.string().default('no_reply@horizonst.com.es'),
  MAIL_PASSWORD: z.string().default('No_reply#2024'),
  MAIL_FROM: z.string().default('no_reply@horizonst.com.es'),
  MAIL_EHLO_DOMAIN: z.string().default('horizonst.com.es'),
  MAIL_TLS_REJECT_UNAUTHORIZED: z.coerce.boolean().default(false),
  APP_BASE_URL: z.string().default('https://horneo.horizonst.com.es')
});

export const env = schema.parse(process.env);
