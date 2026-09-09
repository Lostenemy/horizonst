import type { Pool } from 'pg';

export function validPassword(value: unknown): value is string {
  // PostgreSQL crypt('bf') solo distingue los primeros 72 bytes.
  return typeof value === 'string' && value.length >= 10 && Buffer.byteLength(value, 'utf8') <= 72;
}

export async function resetPasswordWithToken(db: Pool, token: string, password: string): Promise<boolean> {
  if (!validPassword(password)) return false;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT user_id FROM password_reset_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()', [token]
    );
    const userId = found.rows[0]?.user_id;
    if (!userId) { await client.query('ROLLBACK'); return false; }
    // Mismo bloqueo que el login: una autenticación concurrente no puede recrear una sesión antigua.
    const user = await client.query("SELECT id FROM app_users WHERE id = $1 AND status = 'active' FOR UPDATE", [userId]);
    if (!user.rowCount) { await client.query('ROLLBACK'); return false; }
    const consumed = await client.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE token = $1 AND user_id = $2 AND used_at IS NULL AND expires_at > clock_timestamp() RETURNING id', [token, userId]
    );
    if (!consumed.rowCount) { await client.query('ROLLBACK'); return false; }
    await client.query("UPDATE app_users SET password_hash = crypt($2, gen_salt('bf')), updated_at = NOW() WHERE id = $1", [userId, password]);
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
    await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
