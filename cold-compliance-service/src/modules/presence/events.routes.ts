import { Router } from 'express';
import { db } from '../../db/pool';

export const eventsRouter = Router();

eventsRouter.get('/presence', async (req, res, next) => {
  try {
    const workerId = req.query.workerId as string | undefined;
    if (workerId) {
      const result = await db.query(
        `SELECT s.* FROM cold_room_sessions s
         WHERE s.worker_id = $1 ORDER BY s.started_at DESC LIMIT 500`,
        [workerId]
      );
      res.json(result.rows);
      return;
    }
    res.json((await db.query('SELECT * FROM cold_room_sessions ORDER BY started_at DESC LIMIT 500')).rows);
  } catch (e) { next(e); }
});

eventsRouter.get('/active-sessions', async (_req, res, next) => {
  try {
    res.json((await db.query('SELECT * FROM cold_room_sessions WHERE ended_at IS NULL ORDER BY started_at DESC')).rows);
  } catch (e) { next(e); }
});

eventsRouter.get('/workday/:workerId', async (req, res, next) => {
  try {
    res.json(
      (
        await db.query(
          `SELECT * FROM workday_accumulators WHERE worker_id = $1 ORDER BY workday_date DESC LIMIT 30`,
          [req.params.workerId]
        )
      ).rows
    );
  } catch (e) { next(e); }
});
