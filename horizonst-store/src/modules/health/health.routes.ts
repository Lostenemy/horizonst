import { Router } from 'express';
import { databaseLifecycle } from '../../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  try {
    if (!await databaseLifecycle.ready()) throw new Error('database_unavailable');
    res.json({ status: 'ok', service: 'horizonst-store', database: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'horizonst-store', database: 'unavailable' });
  }
});
