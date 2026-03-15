import { config } from './config.js';
import type { LogLevel } from './types.js';

const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

const shouldLog = (level: LogLevel): boolean => {
  return levels.indexOf(level) >= levels.indexOf(config.app.logLevel);
};

const write = (level: LogLevel, message: string, meta?: unknown): void => {
  if (!shouldLog(level)) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta !== undefined ? { meta } : {})
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
};

export const logger = {
  debug: (message: string, meta?: unknown) => write('debug', message, meta),
  info: (message: string, meta?: unknown) => write('info', message, meta),
  warn: (message: string, meta?: unknown) => write('warn', message, meta),
  error: (message: string, meta?: unknown) => write('error', message, meta)
};
