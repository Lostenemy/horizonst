import 'dotenv/config';
import { Pool, PoolClient } from 'pg';
import { normalizeGatewayMac } from '../utils/mac';
import { buildGatewayReconciliation } from '../services/gatewayReconciliation';

type LocalGateway = {
  id: string;
  gateway_mac: string | null;
  description: string | null;
  rssi_threshold: number;
  cold_room_id: string | null;
  plant_id: string | null;
  hardware_gateway_id: number | null;
  created_at: string;
};

type CentralGateway = {
  id: number;
  name: string | null;
  mac_address: string;
  description: string | null;
  rssi_threshold: number;
  active: boolean;
  company_id: string | null;
  company_code: string | null;
};

type PlannedGateway = {
  local: LocalGateway;
  mac: string;
  central?: CentralGateway;
  action: 'create' | 'reuse' | 'link_unassigned';
  differences: string[];
};

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const numberFromEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

async function updateCentralGateway(
  client: PoolClient,
  plan: PlannedGateway,
  companyId: string
): Promise<number> {
  if (!plan.central) {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO gateways(name, mac_address, description, company_id, rssi_threshold, active)
       VALUES($1, $2, $3, $4, $5, TRUE)
       RETURNING id`,
      [plan.local.description || `Gateway ${plan.mac}`, plan.mac, plan.local.description, companyId, plan.local.rssi_threshold]
    );
    return inserted.rows[0].id;
  }
  const updated = await client.query<{ id: number }>(
    `UPDATE gateways
     SET mac_address = $2, company_id = $3, rssi_threshold = $4, updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [plan.central.id, plan.mac, companyId, plan.local.rssi_threshold]
  );
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
    const companyResult = await central.query<{ id: string; active: boolean }>(
      "SELECT id, active FROM companies WHERE code = 'horneo'"
    );
    const company = companyResult.rows[0];
    const localRows = (await local.query<LocalGateway>(
      `SELECT id, gateway_mac, description, rssi_threshold, cold_room_id, plant_id,
              hardware_gateway_id, created_at
       FROM gateways ORDER BY created_at, id`
    )).rows;
    const centralRows = (await central.query<CentralGateway>(
      `SELECT g.id, g.name, g.mac_address, g.description, g.rssi_threshold, g.active,
              g.company_id, c.code AS company_code
       FROM gateways g LEFT JOIN companies c ON c.id = g.company_id
       ORDER BY g.id`
    )).rows;

    const reconciliation = buildGatewayReconciliation({ localRows, centralRows, company });
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
        alreadyLinked: plans.filter((plan) => plan.local.hardware_gateway_id === plan.central?.id).length,
        conflicts: conflicts.length,
        centralHorneoWithoutLocal: centralWithoutLocal.length,
        centralWithoutCompany: centralWithoutCompany.length
      },
      conflicts,
      propertyDifferences: plans.filter((plan) => plan.differences.length).map((plan) => ({
        localGatewayId: plan.local.id,
        centralGatewayId: plan.central?.id ?? null,
        mac: plan.mac,
        fields: plan.differences
      })),
      centralHorneoWithoutLocal: centralWithoutLocal,
      centralWithoutCompany,
      plannedActions: plans.map((plan) => ({
        localGatewayId: plan.local.id,
        centralGatewayId: plan.central?.id ?? null,
        mac: plan.mac,
        action: plan.action,
        coldRoomId: plan.local.cold_room_id,
        plantId: plan.local.plant_id,
        rssiThreshold: plan.local.rssi_threshold
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
      for (const plan of plans) {
        const centralId = await updateCentralGateway(centralClient, plan, company.id);
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
        await localClient.query(
          'UPDATE gateways SET hardware_gateway_id = $2 WHERE id = $1',
          [mapping.localId, mapping.centralId]
        );
      }
      await localClient.query('COMMIT');
    } catch (error) {
      await localClient.query('ROLLBACK');
      throw error;
    } finally {
      localClient.release();
    }

    const verification = await local.query<{
      total: number;
      linked: number;
      distinct_links: number;
    }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(hardware_gateway_id)::int AS linked,
              COUNT(DISTINCT hardware_gateway_id)::int AS distinct_links
       FROM gateways`
    );
    report.appliedMappings = mappings;
    report.verification = verification.rows[0];
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
