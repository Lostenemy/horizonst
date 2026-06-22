import dotenv from 'dotenv';

dotenv.config();

const numberFromEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  auth: {
    jwtSecret: process.env.STORE_JWT_SECRET ?? 'dev-only-change-me',
    accessTokenTtl: process.env.STORE_ACCESS_TOKEN_TTL ?? '15m',
    refreshTokenTtl: process.env.STORE_REFRESH_TOKEN_TTL ?? '30d',
    passwordResetTtl: process.env.STORE_PASSWORD_RESET_TTL ?? '1h'
  }
};
