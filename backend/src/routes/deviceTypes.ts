import { Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { authorizeHardware } from '../middleware/hardwareRbac';
import { pool } from '../db/pool';
import { appendTechnicalAudit } from '../services/technicalAudit';
import { validDeviceTypeCode } from '../services/deviceTypePolicy';

const router = Router();
router.use(authenticate);
router.get('/', async (_req, res) => {
  try { return res.json((await pool.query('SELECT code,name,description,active FROM device_types ORDER BY name,code')).rows); }
  catch { return res.status(503).json({ message: 'Device type catalog temporarily unavailable' }); }
});
router.post('/', authorizeHardware('superadmin'), async (req: AuthenticatedRequest, res) => {
  const { code, name, description = '' } = req.body || {};
  if (!validDeviceTypeCode(code) || typeof name !== 'string' || !name.trim() || name.length > 160
    || typeof description !== 'string' || description.length > 2000) return res.status(400).json({ message: 'Invalid device type' });
  let client;
  try { client = await pool.connect(); } catch { return res.status(503).json({ message: 'Catalog temporarily unavailable' }); }
  try {
    await client.query('BEGIN');
    const after = (await client.query('INSERT INTO device_types(code,name,description) VALUES($1,$2,$3) RETURNING *', [code,name.trim(),description.trim()])).rows[0];
    await appendTechnicalAudit({ actorUserId: req.user!.id, action: 'device_type.create', entityType: 'device_type', entityId: code, requestId: req.requestId, result: 'success', after }, client);
    await client.query('COMMIT'); return res.status(201).json(after);
  } catch (error: any) {
    await client.query('ROLLBACK');
    return res.status(error.code === '23505' ? 409 : 503).json({ message: error.code === '23505' ? 'Type code already exists' : 'Catalog change failed' });
  } finally { client.release(); }
});
// DELETE significa baja lógica. Nunca DELETE SQL ni cambio del código técnico.
for (const method of ['patch','delete'] as const) router[method]('/:code', authorizeHardware('superadmin'), async (req: AuthenticatedRequest, res) => {
  if (!validDeviceTypeCode(req.params.code)) return res.status(400).json({ message: 'Invalid type code' });
  const body = method === 'delete' ? { active: false } : req.body || {};
  if (Object.keys(body).some(key => !['name','description','active'].includes(key))
    || !Object.keys(body).length || (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 160))
    || (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 2000))
    || (body.active !== undefined && typeof body.active !== 'boolean')) return res.status(400).json({ message: 'Invalid type update; technical code is immutable' });
  let client;
  try { client = await pool.connect(); } catch { return res.status(503).json({ message: 'Catalog temporarily unavailable' }); }
  try {
    await client.query('BEGIN');
    const before = (await client.query('SELECT * FROM device_types WHERE code=$1 FOR UPDATE', [req.params.code])).rows[0];
    if (!before) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Type not found' }); }
    const after = (await client.query('UPDATE device_types SET name=$2,description=$3,active=$4,updated_at=NOW() WHERE code=$1 RETURNING *',
      [before.code,body.name?.trim() ?? before.name,body.description?.trim() ?? before.description,body.active ?? before.active])).rows[0];
    await appendTechnicalAudit({ actorUserId: req.user!.id, action: 'device_type.update', entityType: 'device_type', entityId: before.code, requestId: req.requestId, result: 'success', before, after }, client);
    await client.query('COMMIT'); return res.json(after);
  } catch { await client.query('ROLLBACK'); return res.status(503).json({ message: 'Catalog change failed' }); }
  finally { client.release(); }
});
export default router;
