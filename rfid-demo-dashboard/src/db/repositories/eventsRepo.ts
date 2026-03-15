import { pool } from '../pool.js';
import type { InventoryDirection, ReadEventRow } from '../../types.js';

export interface InsertReadEventInput {
  epc: string;
  readerMac: string;
  antenna: number | null;
  direction: InventoryDirection;
  isRegistered: boolean;
  rawPayload: Record<string, unknown>;
  eventTs: Date;
  ignoredByDebounce: boolean;
  debounceWindowMs: number;
}

export const insertReadEvent = async (input: InsertReadEventInput): Promise<ReadEventRow> => {
  const { rows } = await pool.query<ReadEventRow>(
    `INSERT INTO public.rfid_demo_read_events
      (epc, reader_mac, antenna, direction, is_registered, raw_payload, event_ts,
       ignored_by_debounce, debounce_window_ms, processed_at)
     VALUES
      ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, NOW())
     RETURNING id, epc, reader_mac, antenna, direction, is_registered, raw_payload,
               event_ts, processed_at, ignored_by_debounce, debounce_window_ms`,
    [
      input.epc,
      input.readerMac,
      input.antenna,
      input.direction,
      input.isRegistered,
      JSON.stringify(input.rawPayload),
      input.eventTs,
      input.ignoredByDebounce,
      input.debounceWindowMs
    ]
  );
  return rows[0];
};

export const listRecentEvents = async (limit: number): Promise<ReadEventRow[]> => {
  const { rows } = await pool.query<ReadEventRow>(
    `SELECT id, epc, reader_mac, antenna, direction, is_registered, raw_payload,
            event_ts, processed_at, ignored_by_debounce, debounce_window_ms
     FROM public.rfid_demo_read_events
     ORDER BY processed_at DESC
     LIMIT $1`,
    [limit]
  );

  return rows;
};
