import type { RegisteredTagInfo } from '../../types.js';
import { pool } from '../pool.js';

export const findRegisteredTag = async (epc: string): Promise<RegisteredTagInfo | null> => {
  const { rows } = await pool.query<{
    card_uid: string;
    dni: string;
    first_name: string;
    last_name: string;
    company_name: string;
    company_cif: string;
    center_code: string;
    active: boolean;
  }>(
    `SELECT card_uid, dni, first_name, last_name, company_name, company_cif, center_code, active
     FROM public.rfid_cards
     WHERE card_uid = $1
     LIMIT 1`,
    [epc]
  );

  const row = rows[0];
  if (!row || !row.active) {
    return null;
  }

  return {
    cardUid: row.card_uid,
    dni: row.dni,
    firstName: row.first_name,
    lastName: row.last_name,
    companyName: row.company_name,
    companyCif: row.company_cif,
    centerCode: row.center_code,
    active: row.active
  };
};
