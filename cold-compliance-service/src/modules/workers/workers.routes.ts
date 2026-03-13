import { Router } from 'express';
import { db } from '../../db/pool';

export const workersRouter = Router();

workersRouter.post('/', async (req, res, next) => {
  try {
    const { dni, fullName, plantId, role } = req.body;
    const result = await db.query(
      `INSERT INTO workers(dni, full_name, plant_id, role) VALUES($1,$2,$3,$4) RETURNING *`,
      [dni, fullName, plantId, role ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) { next(e); }
});

workersRouter.get('/', async (_req, res, next) => {
  try { res.json((await db.query('SELECT * FROM workers ORDER BY created_at DESC')).rows); } catch (e) { next(e); }
});

workersRouter.patch('/:id', async (req, res, next) => {
  try {
    const { fullName, active, role } = req.body;
    const result = await db.query(
      `UPDATE workers SET full_name = COALESCE($2, full_name), active = COALESCE($3, active), role = COALESCE($4, role)
       WHERE id = $1 RETURNING *`,
      [req.params.id, fullName ?? null, active ?? null, role ?? null]
    );
    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

workersRouter.post('/:id/assign-tag', async (req, res, next) => {
  try {
    const { tagId } = req.body;
    await db.query('UPDATE worker_tag_assignments SET active = false, unassigned_at = NOW() WHERE worker_id = $1 AND active = true', [req.params.id]);
    await db.query('UPDATE worker_tag_assignments SET active = false, unassigned_at = NOW() WHERE tag_id = $1 AND active = true', [tagId]);
    const result = await db.query(
      `INSERT INTO worker_tag_assignments(worker_id, tag_id, assigned_at, active) VALUES($1, $2, NOW(), true) RETURNING *`,
      [req.params.id, tagId]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) { next(e); }
});
