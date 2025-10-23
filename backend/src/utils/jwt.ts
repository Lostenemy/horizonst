import jwt, { Secret, SignOptions, StringValue } from 'jsonwebtoken';
import { config } from '../config';
import { JwtPayload } from '../types';

const secret: Secret = config.jwtSecret;
const parseExpiresIn = (value: string): number | StringValue => {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return value as StringValue;
};

const signOptions: SignOptions = { expiresIn: parseExpiresIn(config.jwtExpiresIn) };

export const signToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, secret, signOptions);
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, secret) as JwtPayload;
};
