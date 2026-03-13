import { NextFunction, Request, Response } from 'express';
import { db } from '../db/pool';

export type AppRole = 'supervisor' | 'administrador' | 'superadministrador';

export interface AuthUser {
  id: string;
  role: AppRole;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    const result = await db.query(
      `SELECT u.id, u.role, u.email
       FROM auth_sessions s
       JOIN app_users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > NOW() AND u.status = 'active'`,
      [token]
    );
    const row = result.rows[0];
    if (!row) return res.status(401).json({ error: 'unauthorized' });

    req.authUser = row;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRoles(roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.authUser.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
