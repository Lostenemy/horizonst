import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth } from './middleware.js';
import { createOpaqueToken, emailVerificationSeconds, expiresAtSql, hashToken, passwordResetSeconds, refreshTokenSeconds, signAccessToken } from './token.js';

const scrypt = promisify(scryptCallback);
const HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const GENERIC_LOGIN_ERROR = 'Email or password is invalid';

const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, KEY_LENGTH)) as any;
  return `${HASH_PREFIX}$${salt}$${key.toString('hex')}`;
};

const verifyPassword = async (password: string, storedHash: string): Promise<boolean> => {
  const [prefix, salt, hashHex] = storedHash.split('$');
  if (prefix !== HASH_PREFIX || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = (await scrypt(password, salt, expected.length)) as any;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const safeUserFields = 'id, email, full_name, phone, role, status, created_at, last_login_at';
const buildAuthResponse = (user: any, refreshToken: string) => ({
  user,
  accessToken: signAccessToken({ sub: user.id, email: user.email, role: user.role, status: user.status }),
  refreshToken
});

export const authRouter = Router();

const registerSchema = z.object({ email: z.string().email().max(320), password: z.string().min(10).max(200), fullName: z.string().min(2).max(200), phone: z.string().max(50).optional() });

authRouter.post('/register', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO store.users (email, password_hash, full_name, phone, role, status) VALUES ($1, $2, $3, $4, 'customer', 'pending_email_verification') RETURNING ${safeUserFields}`,
      [input.email.toLowerCase(), passwordHash, input.fullName, input.phone ?? null]
    );
    await client.query('INSERT INTO store.customer_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [rows[0].id]);
    const verificationToken = createOpaqueToken();
    await client.query('INSERT INTO store.email_verification_tokens (user_id, token_hash, expires_at, user_agent, ip_address) VALUES ($1,$2,$3,$4,$5)', [rows[0].id, hashToken(verificationToken), expiresAtSql(emailVerificationSeconds()), req.header('user-agent') ?? null, req.ip]);
    await client.query('COMMIT');
    res.status(201).json({ user: rows[0], message: 'Account created pending email verification.', verificationToken: process.env.NODE_ENV === 'production' ? undefined : verificationToken });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});



authRouter.post('/verify-email', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = z.object({ token: z.string().min(20) }).parse(req.body);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT evt.id, evt.user_id
       FROM store.email_verification_tokens evt
       JOIN store.users u ON u.id = evt.user_id
       WHERE evt.token_hash = $1
         AND evt.revoked_at IS NULL
         AND evt.used_at IS NULL
         AND evt.expires_at > now()
         AND u.status = 'pending_email_verification'
       FOR UPDATE OF evt, u`,
      [hashToken(input.token)]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Invalid or expired verification token' }); return; }
    await client.query("UPDATE store.users SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'pending_email_verification'", [rows[0].user_id]);
    await client.query('UPDATE store.email_verification_tokens SET used_at = now(), revoked_at = now() WHERE id = $1', [rows[0].id]);
    const userResult = await client.query(`SELECT ${safeUserFields} FROM store.users WHERE id = $1`, [rows[0].user_id]);
    await client.query('COMMIT');
    res.json({ user: userResult.rows[0], message: 'Email verified. Account is active.' });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post('/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const { rows } = await pool.query(`SELECT ${safeUserFields}, password_hash FROM store.users WHERE email = $1`, [input.email.toLowerCase()]);
    const user = rows[0];
    if (!user || user.status !== 'active' || !(await verifyPassword(input.password, user.password_hash))) { res.status(401).json({ error: GENERIC_LOGIN_ERROR }); return; }
    const refreshToken = createOpaqueToken();
    await pool.query('INSERT INTO store.refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address) VALUES ($1,$2,$3,$4,$5)', [user.id, hashToken(refreshToken), expiresAtSql(refreshTokenSeconds()), req.header('user-agent') ?? null, req.ip]);
    await pool.query('UPDATE store.users SET last_login_at = now(), updated_at = now() WHERE id = $1', [user.id]);
    const { password_hash: _passwordHash, ...safeUser } = user;
    res.json(buildAuthResponse(safeUser, refreshToken));
  } catch (error) { next(error); }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const input = z.object({ refreshToken: z.string().min(20) }).parse(req.body);
    const tokenHash = hashToken(input.refreshToken);
    const { rows } = await pool.query(`SELECT rt.id AS token_id, u.${safeUserFields.replaceAll(', ', ', u.')} FROM store.refresh_tokens rt JOIN store.users u ON u.id = rt.user_id WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now() AND u.status = 'active'`, [tokenHash]);
    const user = rows[0];
    if (!user) { res.status(401).json({ error: 'Invalid refresh token' }); return; }
    await pool.query('UPDATE store.refresh_tokens SET last_used_at = now() WHERE id = $1', [user.token_id]);
    res.json({ user, accessToken: signAccessToken({ sub: user.id, email: user.email, role: user.role, status: user.status }) });
  } catch (error) { next(error); }
});

authRouter.post('/logout', async (req, res, next) => {
  try { const token = z.object({ refreshToken: z.string().optional() }).parse(req.body).refreshToken; if (token) await pool.query('UPDATE store.refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(token)]); res.json({ ok: true }); } catch (error) { next(error); }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try { const { rows } = await pool.query(`SELECT ${safeUserFields} FROM store.users WHERE id = $1`, [req.user!.sub]); res.json({ user: rows[0] }); } catch (error) { next(error); }
});

authRouter.post('/request-password-reset', async (req, res, next) => {
  try {
    const input = z.object({ email: z.string().email() }).parse(req.body);
    const { rows } = await pool.query('SELECT id FROM store.users WHERE email = $1 AND status = $2', [input.email.toLowerCase(), 'active']);
    let resetToken: string | undefined;
    if (rows[0]) { resetToken = createOpaqueToken(); await pool.query('INSERT INTO store.password_reset_tokens (user_id, token_hash, expires_at, user_agent, ip_address) VALUES ($1,$2,$3,$4,$5)', [rows[0].id, hashToken(resetToken), expiresAtSql(passwordResetSeconds()), req.header('user-agent') ?? null, req.ip]); }
    res.json({ message: 'If the account exists, password reset instructions will be sent.', resetToken: process.env.NODE_ENV === 'production' ? undefined : resetToken });
  } catch (error) { next(error); }
});

authRouter.post('/reset-password', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = z.object({ token: z.string().min(20), password: z.string().min(10).max(200) }).parse(req.body);
    const { rows } = await client.query('SELECT prt.id, prt.user_id FROM store.password_reset_tokens prt JOIN store.users u ON u.id = prt.user_id WHERE prt.token_hash = $1 AND prt.revoked_at IS NULL AND prt.used_at IS NULL AND prt.expires_at > now() AND u.status = $2', [hashToken(input.token), 'active']);
    if (!rows[0]) { res.status(400).json({ error: 'Invalid or expired reset token' }); return; }
    await client.query('BEGIN');
    await client.query('UPDATE store.users SET password_hash = $2, updated_at = now() WHERE id = $1', [rows[0].user_id, await hashPassword(input.password)]);
    await client.query('UPDATE store.password_reset_tokens SET used_at = now(), revoked_at = now() WHERE id = $1', [rows[0].id]);
    await client.query('UPDATE store.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [rows[0].user_id]);
    await client.query('COMMIT'); res.json({ ok: true });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});
