import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';

type Store = { query: (sql: string, values?: any[]) => Promise<any> };
const WINDOW_SECONDS = 900;
const protectedPaths = new Set(['/login', '/forgot-password', '/request-password-reset', '/reset-password', '/register', '/register-distributor', '/resend-verification']);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

// Contadores atómicos compartidos por réplicas; nunca almacenar emails, contraseñas o tokens.
export function createAuthRateLimit(store: Store): RequestHandler {
  let nextCleanup = 0;
  return async (req, res, next) => {
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    if (req.method !== 'POST' || !protectedPaths.has(path)) { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    // No confiar en X-Forwarded-For arbitrario. Detrás de proxy se comparte este presupuesto.
    const address = req.socket.remoteAddress || 'unknown';
    const account = typeof (req.body?.email ?? req.body?.username) === 'string'
      ? String(req.body.email ?? req.body.username).trim().toLowerCase().slice(0, 320) : '';
    const group = path === '/login' ? 'login' : 'recovery-registration';
    const buckets: Array<[string, number]> = [[digest(group + ':source:' + address), 120]];
    if (account) {
      buckets.push([digest(group + ':account:' + account), 30]);
      buckets.push([digest(group + ':pair:' + address + ':' + account), 10]);
    }
    try {
      if (Date.now() >= nextCleanup) {
        nextCleanup = Date.now() + 60_000;
        await store.query('DELETE FROM auth_rate_limits WHERE bucket_key IN (SELECT bucket_key FROM auth_rate_limits WHERE expires_at <= clock_timestamp() LIMIT 500)');
      }
      for (const [key, limit] of buckets) {
        const result = await store.query(
          `INSERT INTO auth_rate_limits AS budget (bucket_key, attempts, expires_at)
           VALUES ($1, 1, clock_timestamp() + $2::integer * interval '1 second')
           ON CONFLICT (bucket_key) DO UPDATE SET
             attempts = CASE WHEN budget.expires_at <= clock_timestamp() THEN 1 ELSE LEAST(budget.attempts + 1, 1000000) END,
             expires_at = CASE WHEN budget.expires_at <= clock_timestamp() THEN clock_timestamp() + $2::integer * interval '1 second' ELSE budget.expires_at END
           RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp()))))::int AS retry_after`,
          [key, WINDOW_SECONDS]
        );
        const row = result.rows[0];
        if (!row) throw new Error('rate_limit_unavailable');
        if (Number(row.attempts) > limit) {
          res.setHeader('Retry-After', String(row.retry_after));
          res.status(429).json({ error: 'rate_limit_exceeded', message: 'Demasiados intentos. Inténtalo más tarde.' });
          return;
        }
      }
      next();
    } catch {
      // Un fallo del almacén no habilita intentos ilimitados ni revela mensajes SQL.
      res.setHeader('Retry-After', '30');
      res.status(503).json({ error: 'authentication_temporarily_unavailable' });
    }
  };
}
