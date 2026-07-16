import { Router } from 'express';
import { z } from 'zod';
import { pool as defaultPool } from '../../db/pool.js';
import { createOpaqueToken, hashToken } from '../auth/token.js';
import {
  sanitizeMailError,
  sendPrereservationCommercialEmail,
  sendPrereservationConfirmationEmail,
  type PrereservationEmailInput
} from '../shared/mail.js';
import {
  calculatePrereservationOffer,
  isPrereservationCampaignActive,
  PRERESERVATION_ACCESS_SECONDS,
  PRERESERVATION_CAMPAIGN,
  PRERESERVATION_END_AT,
  PUBLIC_PRERESERVATION_SOURCE,
  prereservationCodeSchema,
  prereservationCodes,
  type PrereservationCode
} from './prereservation.service.js';

type QueryResult = { rows: any[] };
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };
type QueryClient = Queryable & { release: () => void };
type TransactionPool = Queryable & { connect: () => Promise<QueryClient> };
export type PrereservationRouterDependencies = {
  pool?: TransactionPool;
  now?: () => number;
  createToken?: () => string;
  sendConfirmationEmail?: (input: PrereservationEmailInput) => Promise<void>;
  sendCommercialEmail?: (input: PrereservationEmailInput) => Promise<void>;
  logMailError?: (event: string, prereservationId: string, error: string) => void;
};

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

export const createPrereservationRouter = (dependencies: PrereservationRouterDependencies = {}) => {
  const router = Router();
  const pool = dependencies.pool ?? defaultPool;
  const now = dependencies.now ?? Date.now;
  const createToken = dependencies.createToken ?? createOpaqueToken;
  const sendConfirmationEmail = dependencies.sendConfirmationEmail ?? sendPrereservationConfirmationEmail;
  const sendCommercialEmail = dependencies.sendCommercialEmail ?? sendPrereservationCommercialEmail;
  const logMailError = dependencies.logMailError ?? ((event, prereservationId, error) => console.error('prereservation_mail_failed', { event, prereservationId, error }));
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
  const loadOffer = async (code: PrereservationCode, queryable: Queryable = pool) => {
    const catalog = await queryable.query(
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
      if (!consumeRate(`email:${email}:${input.code}`, 5, current) || !consumeRate(`ip:${req.ip}`, 20, current)) {
        return res.status(429).json({ error: 'Too many requests' });
      }

      const token = createToken();
      const expiresAt = new Date(now() + PRERESERVATION_ACCESS_SECONDS * 1000);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const lead = await client.query(
          `INSERT INTO store.leads
             (source, full_name, email, interest, privacy_accepted, privacy_accepted_at, campaign_code, offer_code)
           VALUES ($1, '', $2, 'Prerreserva pública 2026', $5, now(), $3, $4)
           ON CONFLICT (lower(email), campaign_code, offer_code) WHERE source = 'public_prereservation_2026'
           DO UPDATE SET privacy_accepted = EXCLUDED.privacy_accepted, privacy_accepted_at = now(),
                         interest = EXCLUDED.interest, updated_at = now()
           RETURNING id`,
          [PUBLIC_PRERESERVATION_SOURCE, email, PRERESERVATION_CAMPAIGN, input.code, input.privacyAccepted]
        );
        await client.query(
          `INSERT INTO store.public_prereservations
             (lead_id, email, campaign_code, offer_code, privacy_accepted, privacy_accepted_at, access_token_hash, access_expires_at)
           VALUES ($1, $2, $3, $4, $5, now(), $6, $7)
           ON CONFLICT (email, campaign_code, offer_code) DO UPDATE SET
             lead_id = EXCLUDED.lead_id,
             privacy_accepted = EXCLUDED.privacy_accepted,
             privacy_accepted_at = now(),
             access_token_hash = EXCLUDED.access_token_hash,
             access_expires_at = EXCLUDED.access_expires_at,
             last_interest_at = now(),
             updated_at = now()
           RETURNING id`,
          [lead.rows[0].id, email, PRERESERVATION_CAMPAIGN, input.code, input.privacyAccepted, hashToken(token), expiresAt]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
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
    let client: QueryClient | null = null;
    try {
      const { code } = codeSchema.parse(req.body ?? {});
      if (!isPrereservationCampaignActive(now())) return res.status(410).json({ error: 'Prereservation campaign has ended' });
      const token = bearerToken(req.header('authorization'));
      if (!token) return res.status(401).json({ error: 'Invalid or expired prereservation access' });
      client = await pool.connect();
      await client.query('BEGIN');
      const matched = await client.query(
        `SELECT id, email, confirmed_at FROM store.public_prereservations
         WHERE access_token_hash = $1 AND campaign_code = $2 AND offer_code = $3 AND access_expires_at > now()
         FOR UPDATE`,
        [hashToken(token), PRERESERVATION_CAMPAIGN, code]
      );
      if (!matched.rows[0]) { await client.query('ROLLBACK'); client.release(); client = null; return res.status(401).json({ error: 'Invalid or expired prereservation access' }); }
      const offer = await loadOffer(code, client);
      if (!offer.available) { await client.query('ROLLBACK'); client.release(); client = null; return res.status(409).json({ error: 'Prereservation offer requires commercial contact' }); }
      const alreadyConfirmed = matched.rows[0].confirmed_at != null;
      const confirmed = await client.query(
        `UPDATE store.public_prereservations SET confirmed_at = COALESCE(confirmed_at, now()), updated_at = now()
         WHERE id = $1 RETURNING confirmed_at`,
        [matched.rows[0].id]
      );
      await client.query('COMMIT');
      client.release();
      client = null;

      if (!alreadyConfirmed) {
        const prereservation = {
          id: matched.rows[0].id,
          email: matched.rows[0].email,
          code,
          confirmedAt: confirmed.rows[0].confirmed_at
        };
        const mailInput: PrereservationEmailInput = { prereservation, offer };
        const safeMailError = (error: unknown) => sanitizeMailError(error).replaceAll(prereservation.email, '[redacted]');
        const deliver = async (kind: 'confirmation' | 'commercial', send: () => Promise<void>) => {
          try {
            await send();
          } catch (error) {
            logMailError(kind, prereservation.id, safeMailError(error));
            await pool.query(
              kind === 'confirmation'
                ? `UPDATE store.public_prereservations SET confirmation_email_last_error_at = now(), confirmation_email_attempts = confirmation_email_attempts + 1 WHERE id = $1 AND confirmation_email_sent_at IS NULL`
                : `UPDATE store.public_prereservations SET commercial_email_last_error_at = now(), commercial_email_attempts = commercial_email_attempts + 1 WHERE id = $1 AND commercial_email_sent_at IS NULL`,
              [prereservation.id]
            ).catch((recordError) => logMailError(`${kind}_status`, prereservation.id, safeMailError(recordError)));
            return;
          }
          await pool.query(
            kind === 'confirmation'
              ? `UPDATE store.public_prereservations SET confirmation_email_sent_at = now(), confirmation_email_last_error_at = NULL, confirmation_email_attempts = confirmation_email_attempts + 1 WHERE id = $1 AND confirmation_email_sent_at IS NULL`
              : `UPDATE store.public_prereservations SET commercial_email_sent_at = now(), commercial_email_last_error_at = NULL, commercial_email_attempts = commercial_email_attempts + 1 WHERE id = $1 AND commercial_email_sent_at IS NULL`,
            [prereservation.id]
          ).catch((recordError) => logMailError(`${kind}_status`, prereservation.id, safeMailError(recordError)));
        };
        await deliver('confirmation', () => sendConfirmationEmail(mailInput));
        await deliver('commercial', () => sendCommercialEmail(mailInput));
      }
      return res.json({ confirmed: true, alreadyConfirmed, code, confirmedAt: confirmed.rows[0].confirmed_at });
    } catch (error) {
      if (client) { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
      return next(error);
    }
  });

  return router;
};

export const prereservationRouter = createPrereservationRouter();
