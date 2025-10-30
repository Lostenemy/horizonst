import { createRequire } from 'node:module';
import type { Logger, LoggerOptions } from 'pino';
import { config } from './config.js';

const require = createRequire(import.meta.url);
const pinoModule = require('pino');
const pinoFactory: (options?: LoggerOptions) => Logger = (
  pinoModule && pinoModule.default ? pinoModule.default : pinoModule
) as (options?: LoggerOptions) => Logger;

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

export const logger: Logger = pinoFactory(options);
