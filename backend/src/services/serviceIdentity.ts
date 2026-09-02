import crypto from 'node:crypto';

export const HARDWARE_READ_SCOPE = 'hardware.read' as const;
export const HARDWARE_COMMAND_SCOPE = 'hardware.command' as const;
export const HARDWARE_SERVICE_SCOPES = [HARDWARE_READ_SCOPE, HARDWARE_COMMAND_SCOPE] as const;
export type HardwareServiceScope = typeof HARDWARE_SERVICE_SCOPES[number];
export const SERVICE_TOKEN_PREFIX = 'hst_svc_';

export function normalizeHardwareServiceScopes(value: unknown): HardwareServiceScope[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const scopes = [...new Set(value)];
  if (scopes.some((scope) => typeof scope !== 'string' || !HARDWARE_SERVICE_SCOPES.includes(scope as HardwareServiceScope))) {
    return null;
  }
  return HARDWARE_SERVICE_SCOPES.filter((scope) => scopes.includes(scope));
}

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
