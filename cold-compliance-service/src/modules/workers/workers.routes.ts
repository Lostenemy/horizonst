import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';

export const workersRouter = Router();
workersRouter.use(requireAuth);

workersRouter.post('/', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const { dni, fullName, plantId, role } = req.body;
    const result = await db.query(
      `INSERT INTO workers(dni, full_name, plant_id, role) VALUES($1,$2,$3,$4) RETURNING *`,
      [dni, fullName, plantId ?? null, role ?? 'trabajador']
    );
    res.status(201).json(result.rows[0]);
  } catch (e) { next(e); }
});

workersRouter.get('/', async (_req, res, next) => {
  try {
    res.json((await db.query('SELECT * FROM workers ORDER BY created_at DESC')).rows);
  } catch (e) { next(e); }
});

workersRouter.patch('/:id', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const { fullName, active, role } = req.body;
    const result = await db.query(
      `UPDATE workers SET full_name = COALESCE($2, full_name), active = COALESCE($3, active), role = COALESCE($4, role), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, fullName ?? null, active ?? null, role ?? null]
    );
    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

workersRouter.post('/:id/assign-tag', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (req, res, next) => {
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

workersRouter.get('/assignments/history', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (_req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM worker_tag_assignments_history ORDER BY assigned_at DESC LIMIT 1000');
    res.json(result.rows);
  } catch (e) { next(e); }
});
