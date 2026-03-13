import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth } from '../../middleware/auth';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/presence', async (_req, res, next) => {
  try {
    const result = await db.query(
      `SELECT s.id, s.started_at, w.full_name, w.dni, t.tag_uid,
              EXTRACT(EPOCH FROM (NOW() - s.started_at))::INT AS elapsed_seconds
       FROM cold_room_sessions s
       JOIN workers w ON w.id = s.worker_id
       LEFT JOIN tags t ON t.id = s.tag_id
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
