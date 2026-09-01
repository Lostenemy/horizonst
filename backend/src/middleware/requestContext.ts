import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from './auth';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestContext = (req: Request, res: Response, next: NextFunction): void => {
  const supplied = req.header('x-request-id');
  const requestId = supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
  (req as AuthenticatedRequest).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};

export const secureHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'"
  ].join('; '));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
};
