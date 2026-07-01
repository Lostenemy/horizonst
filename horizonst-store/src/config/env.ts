import dotenv from 'dotenv';

dotenv.config();

const numberFromEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const booleanFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export type StoreMailConfig = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  ehloDomain: string;
  tlsRejectUnauthorized: boolean;
  commercialTo: string;
};

const isPlaceholderMailValue = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return normalized === 'change-me'
    || normalized === 'change_me'
    || normalized === 'store-smtp-user@example.com'
    || normalized.endsWith('@example.com')
    || normalized.endsWith('@example.invalid');
};

export const validateStoreMailConfig = (mail: StoreMailConfig, nodeEnv: string) => {
  if (!mail.enabled) return;
  if (!mail.user || !mail.password) {
    throw new Error('Store mail credentials must be configured when mail is enabled');
  }
  if (nodeEnv === 'production' && (isPlaceholderMailValue(mail.user) || isPlaceholderMailValue(mail.password))) {
    throw new Error('Store mail credentials must not use placeholder values in production');
  }
};

const jwtSecret = process.env.STORE_JWT_SECRET ?? 'dev-only-change-me';
if ((process.env.NODE_ENV ?? 'development') === 'production' && (!jwtSecret || jwtSecret === 'dev-only-change-me')) {
  throw new Error('STORE_JWT_SECRET must be set to a secure value in production');
}

const mail: StoreMailConfig = {
  enabled: booleanFromEnv(process.env.STORE_MAIL_ENABLED, false),
  host: process.env.STORE_MAIL_HOST ?? 'mail.horizonst.com.es',
  port: numberFromEnv(process.env.STORE_MAIL_PORT, 465),
  secure: booleanFromEnv(process.env.STORE_MAIL_SECURE, true),
  user: process.env.STORE_MAIL_USER ?? '',
  password: process.env.STORE_MAIL_PASSWORD ?? '',
  from: process.env.STORE_MAIL_FROM ?? 'no_reply@horizonst.com.es',
  ehloDomain: process.env.STORE_MAIL_EHLO_DOMAIN ?? 'horizonst.com.es',
  tlsRejectUnauthorized: booleanFromEnv(process.env.STORE_MAIL_TLS_REJECT_UNAUTHORIZED, true),
  commercialTo: process.env.STORE_MAIL_COMMERCIAL_TO ?? 'comercial@horizonst.com.es'
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: numberFromEnv(process.env.PORT ?? process.env.STORE_PORT, 4020),
  databaseUrl: process.env.DATABASE_URL,
  db: {
    host: process.env.DB_HOST ?? 'postgres',
    port: numberFromEnv(process.env.DB_PORT, 5432),
    user: process.env.DB_USER ?? 'horizonst',
    password: process.env.DB_PASSWORD ?? 'horizonst',
    database: process.env.DB_NAME ?? 'horizonst'
  },
  documentsPath: process.env.STORE_DOCUMENTS_PATH ?? '/opt/horizonst/store-data/documents',
  corsOrigin: process.env.STORE_CORS_ORIGIN ?? 'http://127.0.0.1:4020',
  publicBaseUrl: process.env.STORE_PUBLIC_BASE_URL ?? 'https://tienda.horizonst.com.es',
  auth: {
    jwtSecret,
    accessTokenTtl: process.env.STORE_ACCESS_TOKEN_TTL ?? '15m',
    refreshTokenTtl: process.env.STORE_REFRESH_TOKEN_TTL ?? '30d',
    passwordResetTtl: process.env.STORE_PASSWORD_RESET_TTL ?? '1h',
    emailVerificationTtl: process.env.STORE_EMAIL_VERIFICATION_TTL ?? '24h'
  },
  mail
};

validateStoreMailConfig(env.mail, env.nodeEnv);
