import type { RegisteredTagInfo, RegisteredTagRow } from '../../types.js';
import { pool } from '../pool.js';

const mapTag = (row: RegisteredTagRow): RegisteredTagInfo => ({
  epc: row.epc,
  name: row.name,
  description: row.description,
  active: row.active,
  createdAt: row.created_at.toISOString()
});

export const findRegisteredTag = async (epc: string): Promise<RegisteredTagInfo | null> => {
  const { rows } = await pool.query<RegisteredTagRow>(
    `SELECT epc, name, description, active, created_at
     FROM public.rfid_demo_tags
     WHERE epc = $1
     LIMIT 1`,
    [epc]
  );

  const row = rows[0];
  if (!row || !row.active) {
    return null;
  }

  return mapTag(row);
};

export const listRegisteredTags = async (limit: number): Promise<RegisteredTagInfo[]> => {
  const { rows } = await pool.query<RegisteredTagRow>(
    `SELECT epc, name, description, active, created_at
     FROM public.rfid_demo_tags
     WHERE active = TRUE
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  return rows.map(mapTag);
};

export interface UpsertRegisteredTagInput {
  epc: string;
  name?: string | null;
  description?: string | null;
}

export const upsertRegisteredTag = async (input: UpsertRegisteredTagInput): Promise<RegisteredTagInfo> => {
  const { rows } = await pool.query<RegisteredTagRow>(
    `INSERT INTO public.rfid_demo_tags (epc, name, description, active)
     VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), TRUE)
     ON CONFLICT (epc)
     DO UPDATE SET
      name = COALESCE(NULLIF(EXCLUDED.name, ''), public.rfid_demo_tags.name),
      description = COALESCE(NULLIF(EXCLUDED.description, ''), public.rfid_demo_tags.description),
      active = TRUE
     RETURNING epc, name, description, active, created_at`,
    [input.epc, input.name ?? null, input.description ?? null]
  );

  return mapTag(rows[0]);
};


export const deactivateRegisteredTag = async (epc: string): Promise<RegisteredTagInfo | null> => {
  const { rows } = await pool.query<RegisteredTagRow>(
    `UPDATE public.rfid_demo_tags
     SET active = FALSE
     WHERE epc = $1
     RETURNING epc, name, description, active, created_at`,
    [epc]
  );

  const row = rows[0];
  return row ? mapTag(row) : null;
};
