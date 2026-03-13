import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth } from '../../middleware/auth';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/presence', async (_req, res, next) => {
  try {
    const result = await db.query(
      `SELECT s.id,
              s.started_at,
              COALESCE(w.full_name, '(sin trabajador asignado)') AS full_name,
              COALESCE(w.dni, '-') AS dni,
              COALESCE(t.tag_uid, '') AS tag_uid,
              EXTRACT(EPOCH FROM (NOW() - s.started_at))::INT AS elapsed_seconds
       FROM cold_room_sessions s
       LEFT JOIN tags t ON t.id = s.tag_id
       LEFT JOIN worker_tag_assignments wta ON wta.tag_id = s.tag_id AND wta.active = true
       LEFT JOIN workers w ON w.id = COALESCE(s.worker_id, wta.worker_id)
       WHERE s.ended_at IS NULL
       ORDER BY s.started_at ASC`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get('/alerts', async (_req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM alerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 100');
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});
