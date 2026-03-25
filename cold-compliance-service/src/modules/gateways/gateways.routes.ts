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
    const result = await db.query('INSERT INTO gateways(gateway_mac, description) VALUES($1,$2) RETURNING *', [String(mac).toLowerCase(), descripcion ?? null]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.patch('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE gateways
       SET gateway_mac = COALESCE($2, gateway_mac),
           description = COALESCE($3, description)
       WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.mac ? String(req.body.mac).toLowerCase() : null, req.body.descripcion ?? null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.delete('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const gateway = await db.query<{ gateway_mac: string }>('SELECT gateway_mac FROM gateways WHERE id = $1', [req.params.id]);
    if (!gateway.rowCount) return res.status(404).json({ error: 'not_found' });

    const deps = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM tag_commands WHERE gateway_id = $1) AS tag_commands,
         (SELECT COUNT(*)::int FROM presence_events WHERE gateway_mac = $2) AS presence_events`,
      [req.params.id, gateway.rows[0].gateway_mac]
    );

    const row = deps.rows[0] as Record<string, number>;
    const blocked = Object.entries(row).filter(([, count]) => Number(count) > 0).map(([name, count]) => ({ relation: name, count }));
    if (blocked.length) {
      return res.status(409).json({
        error: 'dependency_conflict',
        entity: 'gateway',
        dependencies: blocked,
        message: `No se puede borrar el gateway porque está vinculado a: ${blocked.map((d) => `${d.relation} (${d.count})`).join(', ')}`
      });
    }

    await db.query('DELETE FROM gateways WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (error: any) {
    if (error?.code === '23503') {
      return res.status(409).json({ error: 'dependency_conflict', entity: 'gateway', message: 'No se puede borrar el gateway porque está referenciado por otras tablas' });
    }
    next(error);
  }
});
