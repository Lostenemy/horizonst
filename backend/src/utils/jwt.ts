import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { JwtPayload } from '../types';
import { config } from '../config';

type Expires = NonNullable<SignOptions['expiresIn']>;

function normalizeExpires(value: unknown): Expires {
  const normalized = String(value ?? '').trim();
  if (/^\d+$/.test(normalized)) {
    return Number(normalized) as Expires;
  }
  return normalized as Expires;
}

const secret: Secret = config.jwtSecret;
const expiresIn = normalizeExpires(config.jwtExpiresIn);

const isJwtPayload = (value: unknown): value is JwtPayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<JwtPayload> & { userId?: unknown; role?: unknown };
  return (
    typeof candidate.userId === 'number' &&
    (
      candidate.role === 'ADMIN' ||
      candidate.role === 'USER' ||
      candidate.role === 'hardware_readonly' ||
      candidate.role === 'hardware_technician' ||
      candidate.role === 'hardware_superadmin'
    )
  );
};

export const signToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, secret, { expiresIn });
};

export const verifyToken = (token: string): JwtPayload => {
  const decoded = jwt.verify(token, secret);
  if (!isJwtPayload(decoded)) {
    throw new Error('Invalid token payload');
  }
  return decoded;
};
