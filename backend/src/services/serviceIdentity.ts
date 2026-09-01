import crypto from 'node:crypto';

export const HARDWARE_READ_SCOPE = 'hardware.read' as const;
export const SERVICE_TOKEN_PREFIX = 'hst_svc_';

export function normalizeServiceCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function createOpaqueServiceToken(): string {
  return `${SERVICE_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

export function hashServiceToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function serviceTokenHint(token: string): string {
  return token.slice(-8);
}

export function parseOptionalExpiry(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) return undefined;
  return parsed;
}
