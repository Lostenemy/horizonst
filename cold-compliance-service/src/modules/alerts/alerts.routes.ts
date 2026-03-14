import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

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

alertsRouter.post('/:id/ack', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const result = await db.query('UPDATE alerts SET acknowledged_at = NOW() WHERE id = $1 RETURNING *', [req.params.id]);
    res.json(result.rows[0]);
  } catch (e) { next(e); }
});
