import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { JwtPayload } from '../types';

type Expires = NonNullable<SignOptions['expiresIn']>;

const normalizeExpires = (value: string): Expires => {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    return Number(normalized) as Expires;
  }
  return normalized as Expires;
};

const secret: Secret = config.jwtSecret;
const signOptions: SignOptions = {
  expiresIn: normalizeExpires(config.jwtExpiresIn)
};

export const signToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, secret, signOptions);
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, secret) as JwtPayload;
};
