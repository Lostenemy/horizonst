import { hashToken } from './token.js';

type ResetPool = { connect: () => Promise<{ query: (sql: string, values?: unknown[]) => Promise<any>; release: () => void }> };

export async function resetStorePassword(pool: ResetPool, token: string, passwordHash: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT user_id FROM store.password_reset_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND used_at IS NULL AND expires_at > now()', [hashToken(token)]);
    const userId = found.rows[0]?.user_id;
    if (!userId) { await client.query('ROLLBACK'); return false; }
    const user = await client.query("SELECT id FROM store.users WHERE id = $1 AND status = 'active' FOR UPDATE", [userId]);
    if (!user.rowCount) { await client.query('ROLLBACK'); return false; }
    // Consumo condicional tras bloquear al usuario: exactamente una recuperación gana.
    const consumed = await client.query('UPDATE store.password_reset_tokens SET used_at = now(), revoked_at = now() WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL AND used_at IS NULL AND expires_at > clock_timestamp() RETURNING id', [hashToken(token), userId]);
    if (!consumed.rowCount) { await client.query('ROLLBACK'); return false; }
    await client.query('UPDATE store.users SET password_hash = $2, updated_at = now() WHERE id = $1', [userId, passwordHash]);
    await client.query('UPDATE store.password_reset_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    await client.query('UPDATE store.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
