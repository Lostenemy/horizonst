import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth } from '../../middleware/auth';
import { loadPresenceStateSnapshot } from '../presence/presence-state.service';
import { resolveOperationalAlarmTable } from '../alerts/alarm-table-resolver';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/presence', async (_req, res, next) => {
  try {
    const presence = await loadPresenceStateSnapshot();
    res.json(presence);
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get('/alerts', async (_req, res, next) => {
  try {
    const alarmTable = await resolveOperationalAlarmTable();
    const result = await db.query(`SELECT * FROM ${alarmTable} WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 100`);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});
