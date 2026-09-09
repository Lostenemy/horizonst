import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { randomUUID } from 'node:crypto';

export function errorHandler(err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'validation_error', issues: err.issues });
    return;
  }

  const statusCode = err.statusCode ?? 500;
  const requestId = randomUUID();
  // No registrar mensajes de excepción que puedan incluir credenciales o parámetros SQL.
  logger.error({ requestId, statusCode, errorType: err.name }, 'request failed');
  res.setHeader('X-Request-Id', requestId);
  res.status(statusCode).json({ error: statusCode >= 500 ? 'internal_error' : err.message, message: statusCode >= 500 ? 'Error interno del servidor' : err.message, requestId });
}
