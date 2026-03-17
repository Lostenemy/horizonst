import { pool } from '../pool.js';
import type { CycleHistoryRow, InventoryStateRow } from '../../types.js';

export const getStateByEpc = async (epc: string): Promise<InventoryStateRow | null> => {
  const { rows } = await pool.query<InventoryStateRow>(
    `SELECT epc, is_active, is_registered, last_reader_mac, last_antenna, last_direction,
            first_seen_at, last_seen_at, last_event_ts, updated_at
     FROM public.rfid_demo_inventory_state
     WHERE epc = $1
     LIMIT 1`,
    [epc]
  );

  return rows[0] ?? null;
};

export interface UpsertStateInput {
  epc: string;
  isActive: boolean;
  isRegistered: boolean;
  readerMac: string;
  antenna: number | null;
  direction: 'IN' | 'OUT';
  eventTs: Date;
}

export const upsertState = async (input: UpsertStateInput): Promise<InventoryStateRow> => {
  const { rows } = await pool.query<InventoryStateRow>(
    `INSERT INTO public.rfid_demo_inventory_state
      (epc, is_active, is_registered, last_reader_mac, last_antenna, last_direction,
       first_seen_at, last_seen_at, last_event_ts, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $7, $7, NOW())
     ON CONFLICT (epc)
     DO UPDATE SET
      is_active = EXCLUDED.is_active,
      is_registered = EXCLUDED.is_registered,
      last_reader_mac = EXCLUDED.last_reader_mac,
      last_antenna = EXCLUDED.last_antenna,
      last_direction = EXCLUDED.last_direction,
      last_seen_at = EXCLUDED.last_seen_at,
      last_event_ts = EXCLUDED.last_event_ts,
      updated_at = NOW()
     RETURNING epc, is_active, is_registered, last_reader_mac, last_antenna, last_direction,
               first_seen_at, last_seen_at, last_event_ts, updated_at`,
    [input.epc, input.isActive, input.isRegistered, input.readerMac, input.antenna, input.direction, input.eventTs]
  );

  return rows[0];
};

export interface SnapshotItem {
  epc: string;
  status: 'IN' | 'OUT';
  firstSeenAt: string;
  lastSeenAt: string;
  lastEventTs: string;
  isRegistered: boolean;
}

export const getLatestEventTs = async (): Promise<Date | null> => {
  const { rows } = await pool.query<{ last_event_ts: Date | null }>(
    `SELECT MAX(last_event_ts) AS last_event_ts
     FROM public.rfid_demo_inventory_state`
  );

  return rows[0]?.last_event_ts ?? null;
};

export const closeCycleAndResetState = async (cycleClosedAt: Date, inactivityMs: number): Promise<boolean> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const stateRes = await client.query<InventoryStateRow>(
      `SELECT epc, is_active, is_registered, last_reader_mac, last_antenna, last_direction,
              first_seen_at, last_seen_at, last_event_ts, updated_at
       FROM public.rfid_demo_inventory_state
       ORDER BY updated_at ASC`
    );

    if (stateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const rows = stateRes.rows;
    const cycleStartedAt = rows.reduce(
      (min, row) => (row.first_seen_at < min ? row.first_seen_at : min),
      rows[0].first_seen_at
    );

    const snapshot: SnapshotItem[] = rows.map((row) => ({
      epc: row.epc,
      status: row.last_direction,
      firstSeenAt: row.first_seen_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      lastEventTs: row.last_event_ts.toISOString(),
      isRegistered: row.is_registered
    }));

    await client.query(
      `INSERT INTO public.rfid_demo_cycle_history
        (cycle_started_at, cycle_closed_at, inactivity_ms, active_tags_count, event_count, snapshot, created_at)
       VALUES
        ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
      [cycleStartedAt, cycleClosedAt, inactivityMs, rows.length, rows.length, JSON.stringify(snapshot)]
    );

    await client.query('TRUNCATE TABLE public.rfid_demo_inventory_state');
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const listCycleHistory = async (limit: number): Promise<CycleHistoryRow[]> => {
  const { rows } = await pool.query<CycleHistoryRow>(
    `SELECT id, cycle_started_at, cycle_closed_at, inactivity_ms, active_tags_count, event_count, snapshot, created_at
     FROM public.rfid_demo_cycle_history
     ORDER BY cycle_closed_at DESC
     LIMIT $1`,
    [limit]
  );

  return rows;
};

export const listActiveInventory = async (limit: number): Promise<InventoryStateRow[]> => {
  const { rows } = await pool.query<InventoryStateRow>(
    `SELECT epc, is_active, is_registered, last_reader_mac, last_antenna, last_direction,
            first_seen_at, last_seen_at, last_event_ts, updated_at
     FROM public.rfid_demo_inventory_state
     WHERE is_active = TRUE
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
};

export const listUnregistered = async (limit: number): Promise<InventoryStateRow[]> => {
  const { rows } = await pool.query<InventoryStateRow>(
    `SELECT epc, is_active, is_registered, last_reader_mac, last_antenna, last_direction,
            first_seen_at, last_seen_at, last_event_ts, updated_at
     FROM public.rfid_demo_inventory_state
     WHERE is_registered = FALSE
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
};

export const getSummary = async (): Promise<{
  activeCount: number;
  registeredActiveCount: number;
  unregisteredActiveCount: number;
  totalReadings24h: number;
}> => {
  const [activeResult, readingsResult] = await Promise.all([
    pool.query<{
      active_count: string;
      registered_active_count: string;
      unregistered_active_count: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE is_active = TRUE) AS active_count,
         COUNT(*) FILTER (WHERE is_active = TRUE AND is_registered = TRUE) AS registered_active_count,
         COUNT(*) FILTER (WHERE is_active = TRUE AND is_registered = FALSE) AS unregistered_active_count
       FROM public.rfid_demo_inventory_state`
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM public.rfid_demo_read_events
       WHERE processed_at >= NOW() - INTERVAL '24 hours'`
    )
  ]);

  const active = activeResult.rows[0];
  return {
    activeCount: Number.parseInt(active?.active_count ?? '0', 10),
    registeredActiveCount: Number.parseInt(active?.registered_active_count ?? '0', 10),
    unregisteredActiveCount: Number.parseInt(active?.unregistered_active_count ?? '0', 10),
    totalReadings24h: Number.parseInt(readingsResult.rows[0]?.count ?? '0', 10)
  };
};
