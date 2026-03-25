import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

alertsRouter.get('/', async (req, res, next) => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : 'active';
    const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (state === 'active') conditions.push('a.acknowledged_at IS NULL');
    if (state === 'archived') conditions.push('a.acknowledged_at IS NOT NULL');
    if (severity) {
      values.push(severity);
      conditions.push(`a.severity = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(
        COALESCE(w.full_name, '') ILIKE $${values.length}
        OR COALESCE(w.dni, '') ILIKE $${values.length}
        OR COALESCE(t.tag_uid, '') ILIKE $${values.length}
        OR COALESCE(cr.name, '') ILIKE $${values.length}
        OR a.message ILIKE $${values.length}
      )`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT a.id,
              a.created_at,
              a.acknowledged_at,
              a.acknowledged_by,
              a.alert_type,
              a.severity,
              a.message,
              a.metadata,
              COALESCE(w.full_name, '(sin trabajador)') AS worker_name,
              COALESCE(w.dni, '-') AS worker_dni,
              COALESCE(t.tag_uid, '-') AS tag_uid,
              COALESCE(cr.name, '-') AS cold_room_name,
              CASE WHEN a.acknowledged_at IS NULL THEN 'active' ELSE 'archived' END AS status
       FROM alerts a
       LEFT JOIN workers w ON w.id = a.worker_id
       LEFT JOIN tags t ON t.id = a.tag_id
       LEFT JOIN cold_rooms cr ON cr.id = a.cold_room_id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT 1000`,
      values
    );

    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

alertsRouter.get('/active', async (_req, res, next) => {
  try {
    res.json((await db.query(`SELECT * FROM alerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC`)).rows);
  } catch (e) {
    next(e);
  }
});

alertsRouter.get('/history', async (req, res, next) => {
  try {
    const severity = req.query.severity as string | undefined;
    if (severity) {
      res.json((await db.query('SELECT * FROM alerts WHERE severity = $1 ORDER BY created_at DESC', [severity])).rows);
      return;
    }
    res.json((await db.query('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 1000')).rows);
  } catch (e) {
    next(e);
  }
});

alertsRouter.post('/:id/archive', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE alerts
       SET acknowledged_at = COALESCE(acknowledged_at, NOW()),
           acknowledged_by = COALESCE(acknowledged_by, $2)
       WHERE id = $1
       RETURNING *`,
      [req.params.id, req.authUser?.email ?? 'unknown']
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

alertsRouter.post('/:id/ack', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE alerts
       SET acknowledged_at = COALESCE(acknowledged_at, NOW()),
           acknowledged_by = COALESCE(acknowledged_by, $2)
       WHERE id = $1
       RETURNING *`,
      [req.params.id, req.authUser?.email ?? 'unknown']
    );
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});
