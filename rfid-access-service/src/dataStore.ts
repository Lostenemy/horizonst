import { db, initDatabase } from './db.js';

export interface WorkerRecord {
  dni: string;
  nombre: string;
  apellidos: string;
  empresa: string;
  cif: string;
  centro: string;
  email?: string | null;
  activo: boolean;
  creadoEn: string;
}

export interface CardRecord {
  idTarjeta: string;
  dni: string | null;
  centro?: string | null;
  estado: string;
  notas?: string | null;
  asignadaEn: string;
}

export const listWorkers = async (): Promise<WorkerRecord[]> => {
  await initDatabase();
  const { rows } = await db.query<WorkerRecord>(
    `SELECT dni, nombre, apellidos, empresa, cif, centro, email, activo, creado_en AS "creadoEn" FROM workers ORDER BY apellidos, nombre`
  );
  return rows;
};

export const upsertWorker = async (worker: WorkerRecord): Promise<WorkerRecord> => {
  await initDatabase();
  const { rows } = await db.query<WorkerRecord>(
    `INSERT INTO workers (dni, nombre, apellidos, empresa, cif, centro, email, activo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (dni) DO UPDATE
       SET nombre = EXCLUDED.nombre,
           apellidos = EXCLUDED.apellidos,
           empresa = EXCLUDED.empresa,
           cif = EXCLUDED.cif,
           centro = EXCLUDED.centro,
           email = EXCLUDED.email,
           activo = EXCLUDED.activo
     RETURNING dni, nombre, apellidos, empresa, cif, centro, email, activo, creado_en AS "creadoEn"`,
    [
      worker.dni,
      worker.nombre,
      worker.apellidos,
      worker.empresa,
      worker.cif,
      worker.centro,
      worker.email ?? null,
      worker.activo
    ]
  );

  return rows[0];
};

export const deleteWorker = async (dni: string): Promise<void> => {
  await initDatabase();
  await db.query('UPDATE cards SET estado = $2, notas = $3 WHERE dni = $1', [dni, 'bloqueada', 'Usuario eliminado']);
  await db.query('DELETE FROM workers WHERE dni = $1', [dni]);
};

export const listCards = async (): Promise<CardRecord[]> => {
  await initDatabase();
  const { rows } = await db.query<CardRecord>(
    `SELECT id_tarjeta AS "idTarjeta", dni, centro, estado, notas, asignada_en AS "asignadaEn" FROM cards ORDER BY id_tarjeta`
  );
  return rows;
};

export const upsertCard = async (card: CardRecord): Promise<CardRecord> => {
  await initDatabase();
  const { rows } = await db.query<CardRecord>(
    `INSERT INTO cards (id_tarjeta, dni, centro, estado, notas)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id_tarjeta) DO UPDATE
       SET dni = EXCLUDED.dni,
           centro = EXCLUDED.centro,
           estado = EXCLUDED.estado,
           notas = EXCLUDED.notas
     RETURNING id_tarjeta AS "idTarjeta", dni, centro, estado, notas, asignada_en AS "asignadaEn"`,
    [card.idTarjeta, card.dni, card.centro ?? null, card.estado, card.notas ?? null]
  );

  return rows[0];
};

export const updateCardState = async (idTarjeta: string, estado: string): Promise<CardRecord> => {
  await initDatabase();
  const { rows } = await db.query<CardRecord>(
    `UPDATE cards SET estado = $2, asignada_en = COALESCE(asignada_en, NOW()) WHERE id_tarjeta = $1 RETURNING id_tarjeta AS "idTarjeta", dni, centro, estado, notas, asignada_en AS "asignadaEn"`,
    [idTarjeta, estado]
  );
  return rows[0];
};

export const deleteCard = async (idTarjeta: string): Promise<void> => {
  await initDatabase();
  await db.query('DELETE FROM cards WHERE id_tarjeta = $1', [idTarjeta]);
};
