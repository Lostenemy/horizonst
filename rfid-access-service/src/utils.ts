import { logger } from './logger.js';

export const normalizeMac = (mac: string | undefined | null): string | null => {
  if (!mac) {
    return null;
  }

  return mac.trim().toLowerCase();
};

export const safeJsonParse = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    logger.debug({ err: error }, 'Failed to parse JSON payload');
    return null;
  }
};
