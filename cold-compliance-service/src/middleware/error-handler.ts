import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export function errorHandler(err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'validation_error', issues: err.issues });
    return;
  }

  const statusCode = err.statusCode ?? 500;
  logger.error({ err, statusCode }, 'request failed');
  res.status(statusCode).json({ error: statusCode >= 500 ? 'internal_error' : err.message, message: err.message });
}
