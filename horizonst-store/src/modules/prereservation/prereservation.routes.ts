import { Router } from 'express';
import { isIP } from 'node:net';
import { z } from 'zod';
import { pool as defaultPool } from '../../db/pool.js';
import { createOpaqueToken, hashToken } from '../auth/token.js';
import {
  calculatePrereservationOffer,
  isPrereservationCampaignActive,
  PRERESERVATION_ACCESS_SECONDS,
  PRERESERVATION_CAMPAIGN,
  PRERESERVATION_END_AT,
  prereservationCodeSchema,
  prereservationCodes,
  type PrereservationCode
} from './prereservation.service.js';

type QueryResult = { rows: any[] };
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };
export type PrereservationRouterDependencies = { pool?: Queryable; now?: () => number; createToken?: () => string };

const accessSchema = z.object({
  email: z.string().trim().email().max(320),
  code: prereservationCodeSchema,
  privacyAccepted: z.literal(true),
  website: z.string().max(200).optional()
}).strict();
const codeSchema = z.object({ code: prereservationCodeSchema }).strict();

const bearerToken = (authorization?: string): string | null => {
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(authorization ?? '');
  return match?.[1] ?? null;
};

const requestIp = (req: { ip?: string; header: (name: string) => string | undefined }) => {
  const forwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded && isIP(forwarded) ? forwarded : (req.ip ?? 'unknown');
};

export const createPrereservationRouter = (dependencies: PrereservationRouterDependencies = {}) => {
  const router = Router();
  const pool = dependencies.pool ?? defaultPool;
  const now = dependencies.now ?? Date.now;
  const createToken = dependencies.createToken ?? createOpaqueToken;
  const attempts = new Map<string, number[]>();
  const consumeRate = (key: string, limit: number, current: number) => {
    if (attempts.size >= 5000) {
      for (const [storedKey, times] of attempts) {
        if (times.every((time) => current - time >= 60 * 60 * 1000)) attempts.delete(storedKey);
      }
      if (!attempts.has(key) && attempts.size >= 5000) return false;
    }
    const recent = (attempts.get(key) ?? []).filter((time) => current - time < 60 * 60 * 1000);
    if (recent.length >= limit) return false;
    attempts.set(key, [...recent, current]);
    return true;
  };
  const loadOffer = async (code: PrereservationCode) => {
    const catalog = await pool.query(
      `SELECT p.code AS pack_code, p.name AS pack_name, p.price_cents AS pack_price_cents,
              p.tax_rate AS pack_tax_rate, p.is_active AS pack_is_active,
              s.code AS plan_code, s.name AS plan_name, s.annual_price_cents AS plan_price_cents,
              s.tax_rate AS plan_tax_rate, s.is_active AS plan_is_active
       FROM (SELECT $1::text AS code) requested
       LEFT JOIN store.packs p ON p.code = requested.code
       LEFT JOIN store.saas_plans s ON s.code = requested.code`,
      [code]
    );
    const row = catalog.rows[0] ?? {};
    return calculatePrereservationOffer(
      code,
      row.pack_code ? { code: row.pack_code, name: row.pack_name, price_cents: row.pack_price_cents, tax_rate: row.pack_tax_rate, is_active: row.pack_is_active } : undefined,
      row.plan_code ? { code: row.plan_code, name: row.plan_name, price_cents: row.plan_price_cents, tax_rate: row.plan_tax_rate, is_active: row.plan_is_active } : undefined
    );
  };

  router.get('/campaign', (_req, res) => {
    res.json({ campaign: PRERESERVATION_CAMPAIGN, endAt: PRERESERVATION_END_AT, active: isPrereservationCampaignActive(now()), codes: prereservationCodes });
  });

  router.post('/access', async (req, res, next) => {
    try {
      const input = accessSchema.parse(req.body ?? {});
      if (!isPrereservationCampaignActive(now())) return res.status(410).json({ error: 'Prereservation campaign has ended' });
      if (input.website) return res.status(202).json({ ok: true });
      const email = input.email.trim().toLowerCase();
      const current = now();
      if (!consumeRate(`email:${email}:${input.code}`, 5, current) || !consumeRate(`ip:${requestIp(req)}`, 20, current)) {
        return res.status(429).json({ error: 'Too many requests' });
      }

      const token = createToken();
      const expiresAt = new Date(now() + PRERESERVATION_ACCESS_SECONDS * 1000);
      await pool.query(
        `INSERT INTO store.public_prereservations
           (email, campaign_code, offer_code, privacy_accepted, privacy_accepted_at, access_token_hash, access_expires_at)
         VALUES ($1, $2, $3, $4, now(), $5, $6)
         ON CONFLICT (email, campaign_code, offer_code) DO UPDATE SET
           privacy_accepted = EXCLUDED.privacy_accepted,
           privacy_accepted_at = now(),
           access_token_hash = EXCLUDED.access_token_hash,
           access_expires_at = EXCLUDED.access_expires_at,
           last_interest_at = now(),
           updated_at = now()
         RETURNING id`,
        [email, PRERESERVATION_CAMPAIGN, input.code, input.privacyAccepted, hashToken(token), expiresAt]
      );
      return res.status(201).json({ accessToken: token, code: input.code, expiresAt: expiresAt.toISOString() });
    } catch (error) { return next(error); }
  });

  router.get('/offer', async (req, res, next) => {
    try {
      const { code } = codeSchema.parse(req.query);
      if (!isPrereservationCampaignActive(now())) return res.status(410).json({ error: 'Prereservation campaign has ended' });
      const token = bearerToken(req.header('authorization'));
      if (!token) return res.status(401).json({ error: 'Invalid or expired prereservation access' });
      const access = await pool.query(
        `SELECT id FROM store.public_prereservations
         WHERE access_token_hash = $1 AND campaign_code = $2 AND offer_code = $3 AND access_expires_at > now()`,
        [hashToken(token), PRERESERVATION_CAMPAIGN, code]
      );
      if (!access.rows[0]) return res.status(401).json({ error: 'Invalid or expired prereservation access' });

      const offer = await loadOffer(code);
      return res.json({ campaign: PRERESERVATION_CAMPAIGN, endAt: PRERESERVATION_END_AT, offer });
    } catch (error) { return next(error); }
  });

  router.post('/confirm', async (req, res, next) => {
    try {
      const { code } = codeSchema.parse(req.body ?? {});
      if (!isPrereservationCampaignActive(now())) return res.status(410).json({ error: 'Prereservation campaign has ended' });
      const token = bearerToken(req.header('authorization'));
      if (!token) return res.status(401).json({ error: 'Invalid or expired prereservation access' });
      const matched = await pool.query(
        `SELECT id, confirmed_at FROM store.public_prereservations
         WHERE access_token_hash = $1 AND campaign_code = $2 AND offer_code = $3 AND access_expires_at > now()`,
        [hashToken(token), PRERESERVATION_CAMPAIGN, code]
      );
      if (!matched.rows[0]) return res.status(401).json({ error: 'Invalid or expired prereservation access' });
      const offer = await loadOffer(code);
      if (!offer.available) return res.status(409).json({ error: 'Prereservation offer requires commercial contact' });
      const alreadyConfirmed = matched.rows[0].confirmed_at != null;
      const confirmed = await pool.query(
        `UPDATE store.public_prereservations SET confirmed_at = COALESCE(confirmed_at, now()), updated_at = now()
         WHERE id = $1 RETURNING confirmed_at`,
        [matched.rows[0].id]
      );
      return res.json({ confirmed: true, alreadyConfirmed, code, confirmedAt: confirmed.rows[0].confirmed_at });
    } catch (error) { return next(error); }
  });

  return router;
};

export const prereservationRouter = createPrereservationRouter();
