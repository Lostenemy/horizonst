import 'dotenv/config';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { JwtPayload } from '../types';

const { JWT_SECRET = 'change_me', JWT_EXPIRES_IN = '8h' } = process.env;

type Expires = NonNullable<SignOptions['expiresIn']>;

function normalizeExpires(value: unknown): Expires {
  const normalized = String(value ?? '').trim();
  if (/^\d+$/.test(normalized)) {
    return Number(normalized) as Expires;
  }
  return normalized as Expires;
}

const secret: Secret = JWT_SECRET;
const expiresIn = normalizeExpires(JWT_EXPIRES_IN);

const isJwtPayload = (value: unknown): value is JwtPayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<JwtPayload> & { userId?: unknown; role?: unknown };
  return (
    typeof candidate.userId === 'number' &&
    (candidate.role === 'ADMIN' || candidate.role === 'USER')
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
