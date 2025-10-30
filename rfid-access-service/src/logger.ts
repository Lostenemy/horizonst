import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from './config.js';

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
