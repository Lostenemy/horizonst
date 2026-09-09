import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

const base64Url = (input: any | string): string => Buffer.from(input).toString('base64url');
const parseDuration = (value: string): number => {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) return 15 * 60;
  const amount = Number(match[1]);
  const unit = match[2];
  return amount * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[unit];
};

export const accessTokenSeconds = (): number => parseDuration(env.auth.accessTokenTtl);
export const refreshTokenSeconds = (): number => parseDuration(env.auth.refreshTokenTtl);
export const passwordResetSeconds = (): number => parseDuration(env.auth.passwordResetTtl);
export const emailVerificationSeconds = (): number => parseDuration(env.auth.emailVerificationTtl);

export type AccessTokenPayload = { sub: string; email: string; role: 'customer' | 'distributor' | 'admin'; status: string; credentialVersion?: string };

export const credentialVersion = (passwordHash: string): string =>
  createHmac('sha256', env.auth.jwtSecret).update('credential-version\0').update(passwordHash).digest('hex');

export const matchesCredentialVersion = (version: unknown, passwordHash: string): boolean => {
  if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version)) return false;
  return timingSafeEqual(Buffer.from(version, 'hex'), Buffer.from(credentialVersion(passwordHash), 'hex'));
};

export const signAccessToken = (payload: AccessTokenPayload): string => {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + accessTokenSeconds(), iss: 'horizonst-store' };
  const header = { alg: 'HS256', typ: 'JWT' };
  const encoded = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(body))}`;
  const signature = createHmac('sha256', env.auth.jwtSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const parts = token.split('.');
  const [header, body, signature] = parts;
  if (parts.length !== 3 || !header || !body || !signature) throw new Error('Invalid token');
  const metadata = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  if (metadata.alg !== 'HS256' || metadata.typ !== 'JWT') throw new Error('Invalid token');
  const expected = createHmac('sha256', env.auth.jwtSecret).update(`${header}.${body}`).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Invalid token');
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!Number.isFinite(parsed.exp) || parsed.exp <= Math.floor(Date.now() / 1000) || parsed.iss !== 'horizonst-store' || typeof parsed.sub !== 'string') throw new Error('Invalid or expired token');
  return { sub: parsed.sub, email: parsed.email, role: parsed.role, status: parsed.status, credentialVersion: parsed.credentialVersion };
};

export const createOpaqueToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const expiresAtSql = (seconds: number): Date => new Date(Date.now() + seconds * 1000);
