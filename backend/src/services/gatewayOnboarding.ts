import type { Pool } from 'pg';
import { pool } from '../db/pool';
import { normalizeGatewayMac } from '../utils/mac';
import { appendTechnicalAudit } from './technicalAudit';

export class GatewayOnboardingConflictError extends Error {}

export interface GatewayOnboardingResult {
  gateway: {
    id: number;
    name: string | null;
    mac_address: string;
    description: string | null;
    owner_id: number | null;
    company_id: string | null;
    active: boolean;
    created_at: string;
    updated_at: string;
  };
  broker: {
    status: 'prepared';
    mountpoint: '';
    clientId: string;
    username: string;
    publishTopic: string;
    subscribeTopic: string;
  };
}

type ConnectablePool = Pick<Pool, 'connect'>;

const exactAcl = (pattern: string): Array<{ pattern: string }> => [{ pattern }];

export function normalizeGatewayOnboardingMac(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!/^(?:[0-9a-f]{12}|(?:[0-9a-f]{2}:){5}[0-9a-f]{2}|(?:[0-9a-f]{2}-){5}[0-9a-f]{2})$/i.test(trimmed)) {
    return null;
  }
  return normalizeGatewayMac(trimmed);
}

export async function onboardGateway(params: {
  macAddress: string;
  actorUserId: number;
  requestId?: string;
}, deps: { database?: ConnectablePool } = {}): Promise<GatewayOnboardingResult> {
  const mac = normalizeGatewayOnboardingMac(params.macAddress);
  if (!mac) throw new Error('Invalid gateway MAC');
  const database = deps.database ?? pool;
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7247))', [mac]);

    const gatewayCollision = await client.query(
      `SELECT id, company_id
       FROM gateways
       WHERE regexp_replace(lower(mac_address), '[^0-9a-f]', '', 'g') = $1
       FOR UPDATE`,
      [mac]
    );
    if (gatewayCollision.rows[0]) throw new GatewayOnboardingConflictError('Gateway MAC is already registered');

    const brokerCollision = await client.query(
      `SELECT client_id, username
       FROM vmq_auth_acl
       WHERE (mountpoint = '' AND client_id = $1) OR username = $1
       FOR UPDATE`,
      [mac]
    );
    if (brokerCollision.rows[0]) throw new GatewayOnboardingConflictError('Gateway broker identity is already registered');

    const inserted = await client.query<GatewayOnboardingResult['gateway']>(
      `INSERT INTO gateways(name, mac_address, description, owner_id, company_id)
       VALUES(NULL, $1, NULL, NULL, NULL)
       RETURNING id, name, mac_address, description, owner_id, company_id, active, created_at, updated_at`,
      [mac]
    );
    const gateway = inserted.rows[0];
    const publishTopic = `gw/${mac}/publish`;
    const subscribeTopic = `gw/${mac}/subscribe`;
    await client.query(
      `INSERT INTO vmq_auth_acl(mountpoint, client_id, username, password, publish_acl, subscribe_acl)
       VALUES('', $1, $1, crypt($1, gen_salt('bf', 10)), $2::jsonb, $3::jsonb)`,
      [mac, JSON.stringify(exactAcl(publishTopic)), JSON.stringify(exactAcl(subscribeTopic))]
    );
    const broker = {
      status: 'prepared' as const,
      mountpoint: '' as const,
      clientId: mac,
      username: mac,
      publishTopic,
      subscribeTopic
    };
    await appendTechnicalAudit({
      actorUserId: params.actorUserId,
      action: 'gateway.onboard',
      entityType: 'gateway',
      entityId: gateway.id,
      companyId: null,
      requestId: params.requestId,
      result: 'success',
      after: { gateway, broker }
    }, client);
    await client.query('COMMIT');
    return { gateway, broker };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve the original failure */ }
    throw error;
  } finally {
    client.release();
  }
}
