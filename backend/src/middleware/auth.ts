import { NextFunction, Request, Response } from 'express';
import { verifyToken, matchesCredentialVersion } from '../utils/jwt';
import { Role } from '../types';
import { pool } from '../db/pool';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    role: Role;
  };
  requestId?: string;
}

export const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization header missing' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = verifyToken(token);
    const result = await pool.query<{ id: number; role: Role; password_hash: string }>(
      'SELECT id, role, password_hash FROM users WHERE id = $1', [decoded.userId]
    );
    const user = result.rows[0];
    if (!user || !matchesCredentialVersion(decoded.credentialVersion, user.password_hash)) {
      return res.status(401).json({ message: 'Invalid token' });
    }
    // Los permisos actuales, no el rol histórico firmado, gobiernan cada solicitud.
    req.user = { id: user.id, role: user.role };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

export const authorize = (roles: Role[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthenticated' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    next();
  };
};
