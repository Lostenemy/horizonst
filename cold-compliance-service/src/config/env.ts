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
  DB_NAME: z.string().default('horizonst'),
  MQTT_URL: z.string().default('mqtt://vernemq:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_CLIENT_ID: z.string().default('cold-compliance-service'),
  MQTT_SUB_TOPICS: z.string().default('gw/+/publish'),
  MAX_CONTINUOUS_MINUTES: z.coerce.number().default(45),
  PRE_ALERT_MINUTES: z.coerce.number().default(40),
  REQUIRED_BREAK_MINUTES: z.coerce.number().default(15),
  MAX_DAILY_MINUTES: z.coerce.number().default(360),
  INCIDENT_GRACE_MINUTES: z.coerce.number().default(2),
  DEAD_MAN_DEFAULT_MINUTES: z.coerce.number().default(3),
  BATTERY_ALERT_THRESHOLD: z.coerce.number().default(20),
  SYNC_BATCH_SIZE: z.coerce.number().default(100)
});

export const env = schema.parse(process.env);
