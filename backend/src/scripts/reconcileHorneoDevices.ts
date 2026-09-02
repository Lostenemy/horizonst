import 'dotenv/config';
import { Pool, PoolClient } from 'pg';
import {
  buildDeviceReconciliation,
  DeviceReconciliationPlan,
  ReconciliationCentralDevice,
  ReconciliationLocalDevice
} from '../services/deviceReconciliation';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

async function updateCentralDevice(
  client: PoolClient,
  plan: DeviceReconciliationPlan,
  companyId: string
): Promise<number> {
  const status = plan.local.active ? 'active' : 'inactive';
  if (!plan.central) {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO devices(name, ble_mac, description, company_id, device_type, status, active)
       VALUES($1, $2, $3, $4, 'b5', $5, $6)
       RETURNING id`,
      [plan.local.model || `B5 ${plan.mac}`, plan.mac, plan.local.model, companyId, status, plan.local.active]
    );
    return inserted.rows[0].id;
  }
  const updated = await client.query<{ id: number }>(
    `UPDATE devices
     SET ble_mac = $2, company_id = $3, device_type = 'b5', status = $4,
         active = $5, updated_at = NOW()
     WHERE id = $1
       AND upper(regexp_replace(ble_mac, '[^0-9A-Fa-f]', '', 'g')) = $2
       AND (company_id IS NULL OR company_id = $3)
       AND active = $5 AND status = $4
       AND device_type IN ('b5', 'unknown')
     RETURNING id`,
    [plan.central.id, plan.mac, companyId, status, plan.local.active]
  );
  if (!updated.rows[0]) {
    throw new Error(`Central device ${plan.central.id} changed after the report; rerun reconciliation`);
  }
  return updated.rows[0].id;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const central = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: numberFromEnv('DB_PORT', 5432),
    user: process.env.DB_USER || 'horizonst',
    password: required('DB_PASSWORD'),
    database: process.env.DB_NAME || 'horizonst'
  });
  const local = new Pool({
    host: process.env.HORNEO_DB_HOST || process.env.DB_HOST || 'postgres',
    port: numberFromEnv('HORNEO_DB_PORT', 5432),
    user: process.env.HORNEO_DB_USER || process.env.DB_USER || 'horizonst',
    password: required('HORNEO_DB_PASSWORD'),
    database: process.env.HORNEO_DB_NAME || 'cold_compliance'
  });

  try {
    const company = (await central.query<{ id: string; active: boolean }>(
      "SELECT id, active FROM companies WHERE code = 'horneo'"
    )).rows[0];
    const localRows = (await local.query<ReconciliationLocalDevice>(
      `SELECT id, tag_uid, model, active, hardware_device_id, created_at
       FROM tags ORDER BY created_at, id`
    )).rows;
    const centralRows = (await central.query<ReconciliationCentralDevice>(
      `SELECT d.id, d.name, d.ble_mac, d.description, d.device_type, d.status,
              d.active, d.company_id, c.code AS company_code
       FROM devices d LEFT JOIN companies c ON c.id = d.company_id
       ORDER BY d.id`
    )).rows;

    const reconciliation = buildDeviceReconciliation({ localRows, centralRows, company });
    const { conflicts, plans, centralWithoutLocal, centralWithoutCompany } = reconciliation;
    const report: Record<string, unknown> = {
      mode: apply ? 'apply' : 'report',
      company: company ? { id: company.id, code: 'horneo', active: company.active } : null,
      counts: {
        local: localRows.length,
        central: centralRows.length,
        matched: plans.filter((plan) => plan.central).length,
        new: plans.filter((plan) => plan.action === 'create').length,
        linkUnassigned: plans.filter((plan) => plan.action === 'link_unassigned').length,
        alreadyLinked: plans.filter((plan) => plan.local.hardware_device_id === plan.central?.id).length,
        conflicts: conflicts.length,
        centralHorneoWithoutLocal: centralWithoutLocal.length,
        centralWithoutCompany: centralWithoutCompany.length
      },
      conflicts,
      propertyDifferences: plans.filter((plan) => plan.differences.length).map((plan) => ({
        localTagId: plan.local.id,
        centralDeviceId: plan.central?.id ?? null,
        mac: plan.mac,
        fields: plan.differences
      })),
      centralHorneoWithoutLocal: centralWithoutLocal,
      centralWithoutCompany,
      plannedActions: plans.map((plan) => ({
        localTagId: plan.local.id,
        centralDeviceId: plan.central?.id ?? null,
        mac: plan.mac,
        action: plan.action,
        model: plan.local.model,
        active: plan.local.active
      }))
    };

    if (!apply) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (conflicts.length || !company) {
      console.log(JSON.stringify(report, null, 2));
      throw new Error('Reconciliation stopped because conflicts exist');
    }

    const centralClient = await central.connect();
    const mappings: Array<{ localId: string; centralId: number; mac: string }> = [];
    try {
      await centralClient.query('BEGIN');
      const lockedCompany = await centralClient.query<{ active: boolean }>(
        'SELECT active FROM companies WHERE id = $1 FOR SHARE',
        [company.id]
      );
      if (!lockedCompany.rows[0]?.active) {
        throw new Error('Horneo company changed or became inactive after the report');
      }
      for (const plan of plans) {
        const centralId = await updateCentralDevice(centralClient, plan, company.id);
        mappings.push({ localId: plan.local.id, centralId, mac: plan.mac });
      }
      await centralClient.query('COMMIT');
    } catch (error) {
      await centralClient.query('ROLLBACK');
      throw error;
    } finally {
      centralClient.release();
    }

    const localClient = await local.connect();
    try {
      await localClient.query('BEGIN');
      for (const mapping of mappings) {
        const plan = plans.find((item) => item.local.id === mapping.localId)!;
        const linked = await localClient.query(
          `UPDATE tags SET hardware_device_id = $2
           WHERE id = $1
             AND upper(regexp_replace(tag_uid, '[^0-9A-Fa-f]', '', 'g')) = $3
             AND active = $4
             AND (hardware_device_id IS NULL OR hardware_device_id = $2)
           RETURNING id`,
          [mapping.localId, mapping.centralId, mapping.mac, plan.local.active]
        );
        if (!linked.rows[0]) {
          throw new Error(`Local tag ${mapping.localId} changed after the report; rerun reconciliation`);
        }
      }
      await localClient.query('COMMIT');
    } catch (error) {
      await localClient.query('ROLLBACK');
      throw error;
    } finally {
      localClient.release();
    }

    report.appliedMappings = mappings;
    report.verification = (await local.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(hardware_device_id)::int AS linked,
              COUNT(DISTINCT hardware_device_id)::int AS distinct_links
       FROM tags`
    )).rows[0];
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.allSettled([central.end(), local.end()]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
