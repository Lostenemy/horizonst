import { pool } from '../pool.js';
import type { InventoryStateRow } from '../../types.js';

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
    [
      input.epc,
      input.isActive,
      input.isRegistered,
      input.readerMac,
      input.antenna,
      input.direction,
      input.eventTs
    ]
  );

  return rows[0];
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
