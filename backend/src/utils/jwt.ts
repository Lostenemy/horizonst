import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { JwtPayload } from '../types';

const secret: Secret = config.jwtSecret;
const signOptions: SignOptions = { expiresIn: config.jwtExpiresIn };

export const signToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, secret, signOptions);
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, secret) as JwtPayload;
};
