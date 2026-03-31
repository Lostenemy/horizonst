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
              EXTRACT(EPOCH FROM (NOW() - s.started_at))::INT AS elapsed_seconds,
              CASE WHEN COALESCE(pos.in_alarm, FALSE) THEN 'alarma' ELSE 'dentro' END AS presence_status
       FROM cold_room_sessions s
       LEFT JOIN presence_operational_state pos ON pos.tag_id = s.tag_id
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

dashboardRouter.get('/grace', async (_req, res, next) => {
  try {
    const result = await db.query(
      `SELECT pos.tag_id,
              COALESCE(w.full_name, wa.full_name, '(sin trabajador asignado)') AS full_name,
              GREATEST(0, EXTRACT(EPOCH FROM (pos.grace_until - NOW()))::INT) AS remaining_seconds,
              'gracia' AS presence_status
       FROM presence_operational_state pos
       LEFT JOIN workers w ON w.id = pos.worker_id
       LEFT JOIN worker_tag_assignments wta ON wta.tag_id = pos.tag_id AND wta.active = TRUE
       LEFT JOIN workers wa ON wa.id = wta.worker_id
       WHERE pos.inside = FALSE
         AND pos.in_grace = TRUE
         AND pos.grace_until > NOW()
       ORDER BY pos.grace_until ASC`
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
