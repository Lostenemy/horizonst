import crypto from 'crypto';
import { promisify } from 'node:util';

const ITERATIONS = 100000;
const KEYLEN = 64;
const DIGEST = 'sha512';
const pbkdf2 = promisify(crypto.pbkdf2);

export const verifyPasswordAsync = async (password: string, hash: string, salt: string): Promise<boolean> => {
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== KEYLEN) return false;
  const actual = await pbkdf2(password, salt, ITERATIONS, KEYLEN, DIGEST);
  return crypto.timingSafeEqual(expected, actual);
};

export const hashPassword = (password: string, salt?: string): { hash: string; salt: string } => {
  const generatedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, generatedSalt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
  return { hash, salt: generatedSalt };
};

export const verifyPassword = (password: string, hash: string, salt: string): boolean => {
  const hashed = hashPassword(password, salt).hash;
  return crypto.timingSafeEqual(Buffer.from(hashed, 'hex'), Buffer.from(hash, 'hex'));
};
