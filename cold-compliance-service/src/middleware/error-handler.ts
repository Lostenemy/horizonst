import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  logger.error({ err }, 'request failed');
  res.status(500).json({ error: 'internal_error', message: err.message });
}
