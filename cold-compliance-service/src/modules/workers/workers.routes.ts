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
    res.json((await db.query(
      `SELECT w.*, active_tag.tag_id AS current_tag_id, active_tag.tag_uid AS current_tag_uid
       FROM workers w
       LEFT JOIN LATERAL (
         SELECT a.tag_id, t.tag_uid
         FROM worker_tag_assignments a
         JOIN tags t ON t.id = a.tag_id
         WHERE a.worker_id = w.id AND a.active = true
         ORDER BY a.assigned_at DESC
         LIMIT 1
       ) active_tag ON true
       ORDER BY w.created_at DESC`
    )).rows);
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

workersRouter.delete('/:id', requireRoles(['administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const deps = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM worker_tag_assignments WHERE worker_id = $1) AS assignments,
         (SELECT COUNT(*)::int FROM cold_room_sessions WHERE worker_id = $1) AS sessions,
         (SELECT COUNT(*)::int FROM alerts WHERE worker_id = $1) AS alerts,
         (SELECT COUNT(*)::int FROM incidents WHERE worker_id = $1) AS incidents,
         (SELECT COUNT(*)::int FROM workday_accumulators WHERE worker_id = $1) AS accumulators,
         (SELECT COUNT(*)::int FROM tag_commands WHERE worker_id = $1) AS tag_commands`,
      [req.params.id]
    );

    const row = deps.rows[0] as Record<string, number>;
    const blocked = Object.entries(row).filter(([, count]) => Number(count) > 0).map(([name, count]) => ({ relation: name, count }));
    if (blocked.length) {
      return res.status(409).json({
        error: 'dependency_conflict',
        entity: 'worker',
        dependencies: blocked,
        message: `No se puede borrar el trabajador porque está vinculado a: ${blocked.map((d) => `${d.relation} (${d.count})`).join(', ')}`
      });
    }

    await db.query('DELETE FROM workers WHERE id = $1', [req.params.id]);
    res.status(204).send();
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

workersRouter.post('/:id/unassign-tag', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE worker_tag_assignments
       SET active = false, unassigned_at = NOW()
       WHERE worker_id = $1 AND active = true
       RETURNING *`,
      [req.params.id]
    );

    if (!result.rowCount) {
      return res.status(200).json({ ok: true, unassigned: 0, message: 'El trabajador no tiene tag activo asignado' });
    }

    res.json({ ok: true, unassigned: result.rowCount, assignment: result.rows[0] });
  } catch (e) { next(e); }
});

workersRouter.get('/assignments/history', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (_req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM worker_tag_assignments_history ORDER BY assigned_at DESC LIMIT 1000');
    res.json(result.rows);
  } catch (e) { next(e); }
});
