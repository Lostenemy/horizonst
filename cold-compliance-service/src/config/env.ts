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
  DB_PASSWORD: z.string().default('change_me'),
  DB_NAME: z.string().default('cold_compliance'),
  MQTT_URL: z.string().default('mqtt://vernemq:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_CLIENT_ID: z.string().default('cold-compliance-service'),
  MQTT_SUB_TOPICS: z.string().default(''),
  PRESENCE_EXIT_TIMEOUT_MS: z.coerce.number().default(30000),
  PRESENCE_SWEEP_INTERVAL_MS: z.coerce.number().default(10000),
  PRESENCE_RSSI_ENTRY_MARGIN_DB: z.coerce.number().default(5),
  PRESENCE_HEARTBEAT_RETENTION_DAYS: z.coerce.number().default(7),
  PRESENCE_MAINTENANCE_INTERVAL_MS: z.coerce.number().default(60000),
  PRESENCE_MAINTENANCE_BATCH_SIZE: z.coerce.number().default(10000),
  OPERATIONAL_GRACE_MINUTES: z.coerce.number().default(15),
  REENTRY_REMINDER_INTERVAL_MS: z.coerce.number().default(180000),
  MAX_CONTINUOUS_MINUTES: z.coerce.number().default(45),
  PRE_ALERT_MINUTES: z.coerce.number().default(40),
  REQUIRED_BREAK_MINUTES: z.coerce.number().default(15),
  MAX_DAILY_MINUTES: z.coerce.number().default(360),
  INCIDENT_GRACE_MINUTES: z.coerce.number().default(2),
  DEAD_MAN_DEFAULT_MINUTES: z.coerce.number().default(3),
  BATTERY_ALERT_THRESHOLD: z.coerce.number().default(20),
  SYNC_BATCH_SIZE: z.coerce.number().default(100),
  SYNC_QUEUE_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SYNC_QUEUE_SYNCED_RETENTION_HOURS: z.coerce.number().default(24),
  TAG_CONTROL_GATEWAY_STRATEGY: z.enum(['last_seen', 'camera_assigned', 'hybrid']).default('hybrid'),
  TAG_CONTROL_GATEWAY_CANDIDATE_LIMIT: z.coerce.number().default(4),
  TAG_CONTROL_GATEWAY_CANDIDATE_WINDOW_MS: z.coerce.number().default(120000),
  TAG_ALARM_PHYSICAL_ENABLED: z.coerce.boolean().default(true),
  TAG_ALARM_CONNECT_MAX_RETRIES: z.coerce.number().default(2),
  TAG_ALARM_BLE_SESSION_TTL_MS: z.coerce.number().default(120000),
  TAG_ALARM_POST_CONNECT_DELAY_MS: z.coerce.number().default(1200),
  TAG_ALARM_BETWEEN_ACTION_DELAY_MS: z.coerce.number().default(500),
  TAG_ALARM_DUAL_ACTION_WAIT_MS: z.coerce.number().default(60000),
  MAIL_ENABLED: z.coerce.boolean().default(true),
  MAIL_HOST: z.string().default('mail'),
  MAIL_PORT: z.coerce.number().default(465),
  MAIL_SECURE: z.coerce.boolean().default(true),
  MAIL_USER: z.string().default('no_reply@example.invalid'),
  MAIL_PASSWORD: z.string().default('change_me'),
  MAIL_FROM: z.string().default('no_reply@example.invalid'),
  MAIL_EHLO_DOMAIN: z.string().default('example.invalid'),
  MAIL_TLS_REJECT_UNAUTHORIZED: z.coerce.boolean().default(false),
  APP_BASE_URL: z.string().default('http://localhost:3100'),
  HARDWARE_MANAGER_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  HARDWARE_MANAGER_BASE_URL: z.string().url().default('http://app:3000'),
  HARDWARE_MANAGER_SERVICE_TOKEN: z.string().optional(),
  HARDWARE_MANAGER_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(3000),
  HARDWARE_MANAGER_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
  HARDWARE_MANAGER_B5_CONFIGURATION_TIMEOUT_MS: z.coerce.number().int().min(40000).max(180000).default(45000),
  HARDWARE_MANAGER_MQTT_TOPIC_REFRESH_MS: z.coerce.number().int().min(5000).max(300000).default(30000),
  HARDWARE_MANAGER_CACHE_TTL_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  HARDWARE_MANAGER_CACHE_ERROR_TTL_MS: z.coerce.number().int().min(250).max(30000).default(5000)
}).superRefine((value, ctx) => {
  if (value.HARDWARE_MANAGER_ENABLED && !value.HARDWARE_MANAGER_SERVICE_TOKEN?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['HARDWARE_MANAGER_SERVICE_TOKEN'],
      message: 'HARDWARE_MANAGER_SERVICE_TOKEN is required when Hardware Manager is enabled'
    });
  }
});

export const env = schema.parse(process.env);
