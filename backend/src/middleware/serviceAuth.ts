import { NextFunction, Request, Response } from 'express';
import { pool } from '../db/pool';
import { hashServiceToken, SERVICE_TOKEN_PREFIX } from '../services/serviceIdentity';

export interface ServicePrincipalIdentity {
  id: string;
  code: string;
  companyId: string;
  scopes: string[];
  tokenId: string;
}

export interface ServiceAuthenticatedRequest extends Request {
  servicePrincipal?: ServicePrincipalIdentity;
  requestId?: string;
}

type RateBucket = { windowStartedAt: number; count: number };
const rateBuckets = new Map<string, RateBucket>();

const rateLimitPerMinute = (): number => {
  const parsed = Number(process.env.INTERNAL_SERVICE_RATE_LIMIT_PER_MINUTE ?? 120);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 120;
};

export async function authenticateService(
  req: ServiceAuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> {
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : '';
  if (!token.startsWith(SERVICE_TOKEN_PREFIX)) {
    return res.status(401).json({ message: 'Invalid service credentials' });
  }

  try {
    const result = await pool.query<{
      principal_id: string;
      code: string;
      company_id: string;
      scopes: string[];
      token_id: string;
    }>(
      `SELECT p.id AS principal_id, p.code, p.company_id, p.scopes, t.id AS token_id
       FROM service_principal_tokens t
       JOIN service_principals p ON p.id = t.service_principal_id
       JOIN companies c ON c.id = p.company_id
       WHERE t.token_hash = $1
         AND t.revoked_at IS NULL
         AND (t.expires_at IS NULL OR t.expires_at > NOW())
         AND p.active = TRUE
         AND c.active = TRUE`,
      [hashServiceToken(token)]
    );
    const row = result.rows[0];
    if (!row) return res.status(401).json({ message: 'Invalid service credentials' });

    const now = Date.now();
    const current = rateBuckets.get(row.principal_id);
    const bucket = !current || now - current.windowStartedAt >= 60000
      ? { windowStartedAt: now, count: 1 }
      : { ...current, count: current.count + 1 };
    rateBuckets.set(row.principal_id, bucket);
    if (bucket.count > rateLimitPerMinute()) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ message: 'Service rate limit exceeded' });
    }

    req.servicePrincipal = {
      id: row.principal_id,
      code: row.code,
      companyId: row.company_id,
      scopes: row.scopes,
      tokenId: row.token_id
    };
    await pool.query('UPDATE service_principal_tokens SET last_used_at = NOW() WHERE id = $1', [row.token_id]);
    next();
  } catch (error) {
    console.error('Service authentication failed', error);
    return res.status(503).json({ message: 'Service authentication unavailable' });
  }
}

export const requireServiceScope = (scope: string) =>
  (req: ServiceAuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.servicePrincipal) return res.status(401).json({ message: 'Invalid service credentials' });
    if (!req.servicePrincipal.scopes.includes(scope)) {
      return res.status(403).json({ message: 'Insufficient service scope' });
    }
    next();
  };

export function resetServiceRateLimitsForTests(): void {
  rateBuckets.clear();
}
