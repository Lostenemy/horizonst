import { NextFunction, Response } from 'express';
import { pool } from '../db/pool';
import { Role } from '../types';
import { AuthenticatedRequest } from './auth';

export type HardwareAccessLevel = 'read' | 'technician' | 'superadmin';

export interface HardwareAccessScope {
  global: boolean;
  companyIds: string[];
  legacyOwnerId: number | null;
}

export const isHardwareSuperadmin = (role: Role): boolean =>
  role === 'ADMIN' || role === 'hardware_superadmin';

export const roleAllowsHardware = (role: Role, required: HardwareAccessLevel): boolean => {
  if (isHardwareSuperadmin(role)) return true;
  if (required === 'superadmin') return false;
  if (role === 'hardware_technician') return true;
  if (required === 'read' && role === 'hardware_readonly') return true;
  return false;
};

export const authorizeHardware = (required: HardwareAccessLevel) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
    if (!roleAllowsHardware(req.user.role, required)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };

export const resolveHardwareAccess = async (
  user: NonNullable<AuthenticatedRequest['user']>,
  required: Exclude<HardwareAccessLevel, 'superadmin'> = 'read'
): Promise<HardwareAccessScope> => {
  if (isHardwareSuperadmin(user.role)) {
    return { global: true, companyIds: [], legacyOwnerId: null };
  }

  if (user.role === 'USER') {
    return { global: false, companyIds: [], legacyOwnerId: user.id };
  }

  if (!roleAllowsHardware(user.role, required)) {
    return { global: false, companyIds: [], legacyOwnerId: null };
  }

  const roles = required === 'technician'
    ? ['hardware_technician']
    : ['hardware_readonly', 'hardware_technician'];
  const result = await pool.query<{ company_id: string }>(
    `SELECT m.company_id
     FROM company_user_memberships m
     JOIN companies c ON c.id = m.company_id AND c.active = TRUE
     WHERE m.user_id = $1 AND m.role = ANY($2::varchar[])`,
    [user.id, roles]
  );
  return {
    global: false,
    companyIds: result.rows.map((row) => row.company_id),
    legacyOwnerId: null
  };
};

export const scopedHardwarePredicate = (params: {
  scope: HardwareAccessScope;
  values: unknown[];
  companyColumn: string;
  ownerColumn?: string;
}): string => {
  if (params.scope.global) return 'TRUE';
  if (params.scope.legacyOwnerId !== null && params.ownerColumn) {
    params.values.push(params.scope.legacyOwnerId);
    return `${params.companyColumn} IS NULL AND ${params.ownerColumn} = $${params.values.length}`;
  }
  if (!params.scope.companyIds.length) return 'FALSE';
  params.values.push(params.scope.companyIds);
  return `${params.companyColumn} = ANY($${params.values.length}::uuid[])`;
};
