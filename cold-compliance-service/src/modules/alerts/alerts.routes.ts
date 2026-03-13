import { Router } from 'express';
import { db } from '../../db/pool';

export const alertsRouter = Router();

alertsRouter.get('/active', async (_req, res, next) => {
  try {
    res.json((await db.query(`SELECT * FROM alerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC`)).rows);
  } catch (e) { next(e); }
});

alertsRouter.get('/history', async (req, res, next) => {
  try {
    const severity = req.query.severity as string | undefined;
    if (severity) {
      res.json((await db.query('SELECT * FROM alerts WHERE severity = $1 ORDER BY created_at DESC', [severity])).rows);
      return;
    }
    res.json((await db.query('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 1000')).rows);
  } catch (e) { next(e); }
});
