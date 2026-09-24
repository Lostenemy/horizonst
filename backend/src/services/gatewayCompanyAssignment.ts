import type { Pool } from 'pg';
import { pool } from '../db/pool';
import { appendTechnicalAudit } from './technicalAudit';

export class GatewayAssignmentConflictError extends Error {}
export class GatewayAssignmentNotFoundError extends Error {}

export async function assignGatewayCompany(params: {
  gatewayId: number;
  companyId: string;
  actorUserId: number;
  requestId?: string;
}, deps: { database?: Pick<Pool, 'connect'> } = {}) {
  const client = await (deps.database ?? pool).connect();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked', [7246, params.gatewayId]
    );
    if (!lock.rows[0]?.locked) throw new GatewayAssignmentConflictError('Gateway has an active command sequence');
    locked = true;
    await client.query('BEGIN');
    const gateway = await client.query(
      'SELECT id, mac_address, company_id, active FROM gateways WHERE id = $1 FOR UPDATE',
      [params.gatewayId]
    );
    if (!gateway.rows[0] || !gateway.rows[0].active) {
      throw new GatewayAssignmentNotFoundError('Gateway not found');
    }
    if (gateway.rows[0].company_id !== null) {
      throw new GatewayAssignmentConflictError('Gateway is already assigned to a company');
    }
    const company = await client.query(
      'SELECT id, code, name FROM companies WHERE id = $1 AND active = TRUE FOR SHARE',
      [params.companyId]
    );
    if (!company.rows[0]) throw new GatewayAssignmentNotFoundError('Active company not found');

    // Un gateway de alta nueva solo puede tener historial global de 1030/1000.
    // Las referencias heredadas requieren revisión manual antes de asignarlo.
    const references = await client.query<{ incompatible: boolean }>(
      `SELECT (
        EXISTS(SELECT 1 FROM hardware_gateway_commands WHERE gateway_id = $1 AND company_id IS NOT NULL)
        OR EXISTS(SELECT 1 FROM technical_audit_log
                  WHERE entity_type = 'gateway' AND entity_id = $1::text AND company_id IS NOT NULL)
        OR EXISTS(SELECT 1 FROM hardware_gateway_reads WHERE gateway_id = $1)
        OR EXISTS(SELECT 1 FROM hardware_gateway_observed_settings WHERE gateway_id = $1)
        OR EXISTS(SELECT 1 FROM hardware_gateway_ble_snapshots WHERE gateway_id = $1)
        OR EXISTS(SELECT 1 FROM gateway_places WHERE gateway_id = $1)
        OR EXISTS(SELECT 1 FROM devices WHERE last_gateway_id = $1)
        OR EXISTS(SELECT 1 FROM device_records WHERE gateway_id = $1)
      ) AS incompatible`, [params.gatewayId]
    );
    if (references.rows[0]?.incompatible) {
      throw new GatewayAssignmentConflictError('Gateway has existing references requiring review');
    }
    const updated = await client.query(
      `UPDATE gateways SET company_id = $2, updated_at = NOW()
       WHERE id = $1 AND company_id IS NULL
       RETURNING id, mac_address, company_id, active, updated_at`,
      [params.gatewayId, params.companyId]
    );
    if (!updated.rows[0]) throw new GatewayAssignmentConflictError('Gateway assignment changed concurrently');
    await appendTechnicalAudit({
      actorUserId: params.actorUserId,
      action: 'gateway.company.assign',
      entityType: 'gateway',
      entityId: params.gatewayId,
      companyId: params.companyId,
      requestId: params.requestId,
      result: 'success',
      before: gateway.rows[0],
      after: updated.rows[0]
    }, client);
    await client.query('COMMIT');
    return { gateway: updated.rows[0], company: company.rows[0] };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* retain original error */ }
    throw error;
  } finally {
    let destroyConnection = false;
    if (locked) {
      try {
        const unlocked = await client.query<{ pg_advisory_unlock: boolean }>(
          'SELECT pg_advisory_unlock($1, $2)', [7246, params.gatewayId]
        );
        if (unlocked.rows[0]?.pg_advisory_unlock !== true) destroyConnection = true;
      }
      catch { destroyConnection = true; }
    }
    client.release(destroyConnection ? new Error('Unable to release gateway advisory lock') : undefined);
  }
}
