import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';

export const gatewaysRouter = Router();
gatewaysRouter.use(requireAuth);

gatewaysRouter.get('/', async (_req, res, next) => {
  try {
    res.json((await db.query('SELECT * FROM gateways ORDER BY created_at DESC')).rows);
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.post('/', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const { mac, descripcion } = req.body;
    const result = await db.query(
      'INSERT INTO gateways(gateway_mac, description) VALUES($1,$2) RETURNING *',
      [String(mac).toLowerCase(), descripcion ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

