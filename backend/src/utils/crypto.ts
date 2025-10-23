import crypto from 'crypto';

const ITERATIONS = 100000;
const KEYLEN = 64;
const DIGEST = 'sha512';

export const hashPassword = (password: string, salt?: string): { hash: string; salt: string } => {
  const generatedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, generatedSalt, ITERATIONS, KEYLEN, DIGEST).toString('hex');
  return { hash, salt: generatedSalt };
};

export const verifyPassword = (password: string, hash: string, salt: string): boolean => {
  const hashed = hashPassword(password, salt).hash;
  return crypto.timingSafeEqual(Buffer.from(hashed, 'hex'), Buffer.from(hash, 'hex'));
};
