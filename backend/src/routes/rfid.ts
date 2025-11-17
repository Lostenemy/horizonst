import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

const normalizeCardUid = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toUpperCase();
};

const ensurePositiveInt = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

router.get('/cards', authenticate, authorize(['ADMIN']), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, card_uid, dni, first_name, last_name, company_name, company_cif, center_code,
              notes, active, created_at, updated_at
       FROM rfid_cards
       ORDER BY created_at DESC`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list RFID cards', error);
    return res.status(500).json({ message: 'No se pudieron obtener las tarjetas' });
  }
});

router.post('/cards', authenticate, authorize(['ADMIN']), async (req, res) => {
  const { cardUid, dni, firstName, lastName, companyName, companyCif, centerCode, notes, active } = req.body ?? {};
  const normalizedCard = normalizeCardUid(cardUid);
  if (!normalizedCard || typeof dni !== 'string' || !dni.trim()) {
    return res.status(400).json({ message: 'Tarjeta y DNI son obligatorios' });
  }
  if (typeof firstName !== 'string' || !firstName.trim() || typeof lastName !== 'string' || !lastName.trim()) {
    return res.status(400).json({ message: 'Nombre y apellidos son obligatorios' });
  }
  if (typeof companyName !== 'string' || !companyName.trim() || typeof companyCif !== 'string' || !companyCif.trim()) {
    return res.status(400).json({ message: 'Empresa y CIF son obligatorios' });
  }
  if (typeof centerCode !== 'string' || !centerCode.trim()) {
    return res.status(400).json({ message: 'El código de centro es obligatorio' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO rfid_cards
         (card_uid, dni, first_name, last_name, company_name, company_cif, center_code, notes, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, card_uid, dni, first_name, last_name, company_name, company_cif, center_code,
                 notes, active, created_at, updated_at`,
      [
        normalizedCard,
        dni.trim().toUpperCase(),
        firstName.trim(),
        lastName.trim(),
        companyName.trim(),
        companyCif.trim().toUpperCase(),
        centerCode.trim(),
        typeof notes === 'string' && notes.trim() ? notes.trim() : null,
        active === undefined ? true : Boolean(active)
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return res.status(409).json({ message: 'Ya existe una tarjeta con ese identificador' });
    }
    console.error('Failed to create RFID card', error);
    return res.status(500).json({ message: 'No se pudo guardar la tarjeta' });
  }
});

router.put('/cards/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  const id = ensurePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ message: 'Identificador no válido' });
  }

  const { cardUid, dni, firstName, lastName, companyName, companyCif, centerCode, notes, active } = req.body ?? {};

  const updates: string[] = [];
  const values: unknown[] = [];

  if (cardUid !== undefined) {
    const normalized = normalizeCardUid(cardUid);
    if (!normalized) {
      return res.status(400).json({ message: 'El identificador de tarjeta no puede estar vacío' });
    }
    updates.push(`card_uid = $${updates.length + 1}`);
    values.push(normalized);
  }
  if (dni !== undefined) {
    if (typeof dni !== 'string' || !dni.trim()) {
      return res.status(400).json({ message: 'El DNI no puede estar vacío' });
    }
    updates.push(`dni = $${updates.length + 1}`);
    values.push(dni.trim().toUpperCase());
  }
  if (firstName !== undefined) {
    if (typeof firstName !== 'string' || !firstName.trim()) {
      return res.status(400).json({ message: 'El nombre no puede estar vacío' });
    }
    updates.push(`first_name = $${updates.length + 1}`);
    values.push(firstName.trim());
  }
  if (lastName !== undefined) {
    if (typeof lastName !== 'string' || !lastName.trim()) {
      return res.status(400).json({ message: 'Los apellidos no pueden estar vacíos' });
    }
    updates.push(`last_name = $${updates.length + 1}`);
    values.push(lastName.trim());
  }
  if (companyName !== undefined) {
    if (typeof companyName !== 'string' || !companyName.trim()) {
      return res.status(400).json({ message: 'La empresa no puede estar vacía' });
    }
    updates.push(`company_name = $${updates.length + 1}`);
    values.push(companyName.trim());
  }
  if (companyCif !== undefined) {
    if (typeof companyCif !== 'string' || !companyCif.trim()) {
      return res.status(400).json({ message: 'El CIF no puede estar vacío' });
    }
    updates.push(`company_cif = $${updates.length + 1}`);
    values.push(companyCif.trim().toUpperCase());
  }
  if (centerCode !== undefined) {
    if (typeof centerCode !== 'string' || !centerCode.trim()) {
      return res.status(400).json({ message: 'El código de centro no puede estar vacío' });
    }
    updates.push(`center_code = $${updates.length + 1}`);
    values.push(centerCode.trim());
  }
  if (notes !== undefined) {
    if (notes === null || (typeof notes === 'string' && !notes.trim())) {
      updates.push(`notes = $${updates.length + 1}`);
      values.push(null);
    } else if (typeof notes === 'string') {
      updates.push(`notes = $${updates.length + 1}`);
      values.push(notes.trim());
    }
  }
  if (active !== undefined) {
    updates.push(`active = $${updates.length + 1}`);
    values.push(Boolean(active));
  }

  if (!updates.length) {
    return res.status(400).json({ message: 'No hay cambios para aplicar' });
  }

  updates.push(`updated_at = NOW()`);

  try {
    const result = await pool.query(
      `UPDATE rfid_cards
         SET ${updates.join(', ')}
       WHERE id = $${values.length + 1}
       RETURNING id, card_uid, dni, first_name, last_name, company_name, company_cif, center_code,
                 notes, active, created_at, updated_at`,
      [...values, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Tarjeta no encontrada' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return res.status(409).json({ message: 'Ya existe una tarjeta con ese identificador' });
    }
    console.error('Failed to update RFID card', error);
    return res.status(500).json({ message: 'No se pudo actualizar la tarjeta' });
  }
});

router.delete('/cards/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  const id = ensurePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ message: 'Identificador no válido' });
  }
  try {
    const result = await pool.query('UPDATE rfid_cards SET active = false, updated_at = NOW() WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Tarjeta no encontrada' });
    }
    return res.status(204).send();
  } catch (error) {
    console.error('Failed to disable RFID card', error);
    return res.status(500).json({ message: 'No se pudo deshabilitar la tarjeta' });
  }
});

router.get('/logs', authenticate, authorize(['ADMIN']), async (req, res) => {
  const limitParam = typeof req.query.limit === 'string' ? req.query.limit : undefined;
  const cardParam = typeof req.query.cardUid === 'string' ? req.query.cardUid : undefined;
  const limit = limitParam ? Math.min(Math.max(Number.parseInt(limitParam, 10) || 0, 1), 500) : 50;
  const cardFilter = cardParam ? cardParam.trim().toUpperCase() : null;
  try {
    const result = await pool.query(
      `SELECT l.id, l.card_uid, l.dni, l.center_code, l.company_cif, l.antenna_id, l.direction,
              l.reader_id, l.event_timestamp, l.access_allowed, l.api_status, l.api_error, l.raw_message,
              l.gpio_command_topic, l.gpio_command_payload, l.created_at,
              c.first_name, c.last_name, c.company_name
       FROM rfid_access_logs l
       LEFT JOIN rfid_cards c ON c.card_uid = l.card_uid
       WHERE ($2::text IS NULL OR l.card_uid = $2)
       ORDER BY l.created_at DESC
       LIMIT $1`,
      [limit, cardFilter]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list RFID access logs', error);
    return res.status(500).json({ message: 'No se pudo obtener el histórico' });
  }
});

export default router;
