import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth } from './middleware.js';
import { writeAuditLog } from '../shared/audit.js';
import { sanitizeMailError, sendDistributorWelcomeEmail, sendEmailVerificationEmail } from '../shared/mail.js';
import { env } from '../../config/env.js';
import { createOpaqueToken, emailVerificationSeconds, expiresAtSql, hashToken, passwordResetSeconds, refreshTokenSeconds, signAccessToken } from './token.js';
import { registerDistributorSchema } from './distributor-registration.js';

const scrypt = promisify(scryptCallback);
const HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const GENERIC_LOGIN_ERROR = 'Email or password is invalid';
const RESEND_MESSAGE = 'Si existe una cuenta pendiente, se enviará un nuevo correo de verificación.';

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

export const consumeEmailVerificationToken = async (client: any, tokenId: string, userId: string) => {
  await client.query(
    'UPDATE store.email_verification_tokens SET used_at = now(), revoked_at = now() WHERE id = $1',
    [tokenId]
  );
  await client.query(
    'UPDATE store.email_verification_tokens SET revoked_at = now() WHERE user_id = $2 AND id <> $1 AND revoked_at IS NULL AND used_at IS NULL',
    [tokenId, userId]
  );
};

const verificationUrl = (token: string) => `${env.publicBaseUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
const createVerificationToken = async (client: any, userId: string, userAgent: string | null, ip: string | undefined, revokeExisting = false) => {
  if (revokeExisting) await client.query('UPDATE store.email_verification_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND used_at IS NULL', [userId]);
  const token = createOpaqueToken();
  await client.query('INSERT INTO store.email_verification_tokens (user_id, token_hash, expires_at, user_agent, ip_address) VALUES ($1,$2,$3,$4,$5)', [userId, hashToken(token), expiresAtSql(emailVerificationSeconds()), userAgent, ip]);
  return token;
};
const canResendVerification = async (client: any, userId: string) => {
  const { rows } = await client.query("SELECT MAX(created_at) AS last_sent_at, COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS sent_last_hour FROM store.email_verification_tokens WHERE user_id = $1", [userId]);
  const row = rows[0];
  if (Number(row?.sent_last_hour ?? 0) >= 5) return false;
  return !row?.last_sent_at || Date.now() - new Date(row.last_sent_at).getTime() >= 60_000;
};
const deliverVerificationEmail = async (user: { email: string; full_name: string; role?: string; country?: string | null }, token: string) => {
  try {
    const input = { email: user.email, fullName: user.full_name, verificationUrl: verificationUrl(token), expiresInSeconds: emailVerificationSeconds() };
    if (user.role === 'distributor') await sendDistributorWelcomeEmail({ ...input, countryCode: user.country ?? '' });
    else await sendEmailVerificationEmail(input);
    return true;
  }
  catch (error) { console.error('Verification email delivery failed', sanitizeMailError(error)); return false; }
};

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
    const verificationToken = await createVerificationToken(client, rows[0].id, req.header('user-agent') ?? null, req.ip);
    await client.query('COMMIT');
    const verificationEmailSent = await deliverVerificationEmail(rows[0], verificationToken);
    res.status(201).json({ user: rows[0], message: 'Account created pending email verification.', verificationEmailSent, verificationToken: process.env.NODE_ENV === 'production' ? undefined : verificationToken });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});


export type DistributorRegistrationDependencies = {
  connect?: () => Promise<any>;
  hash?: (password: string) => Promise<string>;
  createToken?: (client: any, userId: string, userAgent: string | null, ip: string | undefined) => Promise<string>;
  audit?: typeof writeAuditLog;
  deliverWelcome?: (user: { email: string; full_name: string; role?: string; country?: string | null }, token: string) => Promise<boolean>;
  production?: boolean;
};

export const createDistributorRegistrationHandler = (dependencies: DistributorRegistrationDependencies = {}) => async (req: any, res: any, next: any) => {
  let client: any;
  let transactionOpen = false;
  try {
    const input = registerDistributorSchema.parse(req.body);
    const passwordHash = await (dependencies.hash ?? hashPassword)(input.password);
    client = await (dependencies.connect ?? (() => pool.connect()))();
    await client.query('BEGIN');
    transactionOpen = true;
    const { rows } = await client.query(
      `INSERT INTO store.users (email, password_hash, full_name, phone, role, status) VALUES ($1, $2, $3, $4, 'distributor', 'pending_email_verification') RETURNING ${safeUserFields}`,
      [input.email.toLowerCase(), passwordHash, input.fullName, input.phone ?? null]
    );
    const profile = await client.query(`INSERT INTO store.distributor_profiles (user_id, company_name, tax_id, billing_address, city, region, province, postal_code, country, website, contact_person, validation_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending') RETURNING id`,
      [rows[0].id, input.company_name, input.tax_id, input.billing_address, input.city, input.region, input.province, input.postal_code, input.country, input.website ?? null, input.contact_person ?? null]);
    await (dependencies.audit ?? writeAuditLog)({ actorUserId: rows[0].id, action: 'distributor_application_created', entityType: 'distributor_profile', entityId: profile.rows[0].id }, client);
    const verificationToken = await (dependencies.createToken ?? createVerificationToken)(client, rows[0].id, req.header('user-agent') ?? null, req.ip);
    await client.query('COMMIT');
    transactionOpen = false;
    const welcomeEmailSent = await (dependencies.deliverWelcome ?? deliverVerificationEmail)({ ...rows[0], country: input.country }, verificationToken);
    res.status(201).json({ user: rows[0], message: 'Distributor account created pending email verification and validation.', welcomeEmailSent, verificationToken: (dependencies.production ?? process.env.NODE_ENV === 'production') ? undefined : verificationToken });
  } catch (error) { if (transactionOpen) await client.query('ROLLBACK'); next(error); } finally { client?.release(); }
};

authRouter.post('/register-distributor', createDistributorRegistrationHandler());


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
    await consumeEmailVerificationToken(client, rows[0].id, rows[0].user_id);
    await writeAuditLog({ actorUserId: rows[0].user_id, action: 'customer_email_verified', entityType: 'customer', entityId: rows[0].user_id, payload: { previous_status: 'pending_email_verification', status: 'active' } }, client);
    const userResult = await client.query(`SELECT ${safeUserFields} FROM store.users WHERE id = $1`, [rows[0].user_id]);
    await client.query('COMMIT');
    res.json({ user: userResult.rows[0], message: 'Email verified. Account is active.' });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

authRouter.post('/resend-verification', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = z.object({ email: z.string().trim().email().max(320) }).strict().parse(req.body);
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT u.id, u.email, u.full_name, u.role, dp.country
      FROM store.users u LEFT JOIN store.distributor_profiles dp ON dp.user_id = u.id
      WHERE u.email = $1 AND u.role IN ('customer', 'distributor') AND u.status = 'pending_email_verification' FOR UPDATE OF u`, [input.email.toLowerCase()]);
    const user = rows[0];
    if (!user) { await client.query('ROLLBACK'); res.json({ message: RESEND_MESSAGE }); return; }
    if (await canResendVerification(client, user.id)) {
      const token = await createVerificationToken(client, user.id, req.header('user-agent') ?? null, req.ip, true);
      await client.query('COMMIT');
      await deliverVerificationEmail(user, token);
    } else await client.query('ROLLBACK');
    res.json({ message: RESEND_MESSAGE });
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
    const row = rows[0];
    if (!row) { res.status(401).json({ error: 'Invalid refresh token' }); return; }
    const { token_id: tokenId, ...user } = row;
    await pool.query('UPDATE store.refresh_tokens SET last_used_at = now() WHERE id = $1', [tokenId]);
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
