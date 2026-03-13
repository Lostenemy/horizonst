import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth } from '../../middleware/auth';
import { env } from '../../config/env';
import { sendMail } from '../../utils/mail';

export const authRouter = Router();

authRouter.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const result = await db.query(
      `SELECT id, email, role, first_name, last_name, status
       FROM app_users
       WHERE (email = $1 OR lower(first_name) = lower($1))
       AND password_hash = crypt($2, password_hash)
       LIMIT 1`,
      [String(username ?? ''), String(password ?? '')]
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'invalid_credentials' });

    const token = crypto.randomBytes(32).toString('hex');
    await db.query('INSERT INTO auth_sessions(token, user_id, expires_at) VALUES($1,$2, NOW() + INTERVAL \'12 hours\')', [token, user.id]);
    res.json({ token, user });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const auth = req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    await db.query('DELETE FROM auth_sessions WHERE token = $1', [token]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(req.authUser);
});

authRouter.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    const userResult = await db.query('SELECT id, email, first_name FROM app_users WHERE email = $1 AND status = $2 LIMIT 1', [String(email ?? ''), 'active']);
    if (userResult.rowCount) {
      const token = crypto.randomBytes(24).toString('hex');
      await db.query(
        'INSERT INTO password_reset_tokens(user_id, token, expires_at) VALUES($1, $2, NOW() + INTERVAL \'30 minutes\')',
        [userResult.rows[0].id, token]
      );

      const resetUrl = `${env.APP_BASE_URL}/?reset_token=${token}`;
      const text = [
        `Hola ${userResult.rows[0].first_name},`,
        '',
        'Se ha solicitado el restablecimiento de tu contraseña en HorizonST Cold Compliance.',
        `Abre este enlace para continuar (válido 30 minutos): ${resetUrl}`,
        '',
        'Si no has solicitado este cambio, ignora este correo.'
      ].join('\n');

      await sendMail(userResult.rows[0].email, 'Recuperación de contraseña HorizonST', text);
    }

    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    const found = await db.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [String(token ?? '')]
    );
    const row = found.rows[0];
    if (!row) return res.status(400).json({ error: 'invalid_token' });

    await db.query('UPDATE app_users SET password_hash = crypt($2, gen_salt(\'bf\')), updated_at = NOW() WHERE id = $1', [row.user_id, String(newPassword ?? '')]);
    await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [row.id]);
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});
