import type { RequestHandler } from 'express';
import { pool } from '../../db/pool.js';
import { verifyAccessToken, type AccessTokenPayload } from './token.js';

declare global {
  namespace Express {
    interface Request { user?: AccessTokenPayload; }
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) { res.status(401).json({ error: 'Authentication required' }); return; }
    const payload = verifyAccessToken(token);
    const { rows } = await pool.query('SELECT id, status, role FROM store.users WHERE id = $1', [payload.sub]);
    if (!rows[0] || rows[0].status !== 'active') { res.status(401).json({ error: 'Authentication required' }); return; }
    req.user = { ...payload, status: rows[0].status, role: rows[0].role };
    next();
  } catch (_error) { res.status(401).json({ error: 'Authentication required' }); }
};

export const requireRole = (...roles: Array<'customer' | 'distributor' | 'admin'>): RequestHandler => (req, res, next) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
  if (!roles.includes(req.user.role)) { res.status(403).json({ error: 'Forbidden' }); return; }
  next();
};
