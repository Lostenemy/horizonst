import { createRequire } from 'node:module';
import type { Logger, LoggerOptions } from 'pino';
import { config } from './config.js';

const require = createRequire(import.meta.url);
const pino: typeof import('pino') = require('pino');

const options: LoggerOptions = {
  level: config.logLevel,
  base: undefined,
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard'
          }
        }
      : undefined
};

export const logger: Logger = pino(options);
