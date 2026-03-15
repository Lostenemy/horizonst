import type { RegisteredTagInfo } from '../../types.js';
import { pool } from '../pool.js';

export const findRegisteredTag = async (epc: string): Promise<RegisteredTagInfo | null> => {
  const { rows } = await pool.query<{
    epc: string;
    name: string | null;
    description: string | null;
    active: boolean;
  }>(
    `SELECT epc, name, description, active
     FROM public.rfid_demo_tags
     WHERE epc = $1
     LIMIT 1`,
    [epc]
  );

  const row = rows[0];
  if (!row || !row.active) {
    return null;
  }

  return {
    epc: row.epc,
    name: row.name,
    description: row.description,
    active: row.active
  };
};
