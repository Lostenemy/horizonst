import { Router } from 'express';
import { validate as validateUuid } from 'uuid';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import {
  authorizeHardware,
  isHardwareSuperadmin,
  resolveHardwareAccess,
  scopedHardwarePredicate
} from '../middleware/hardwareRbac';
import { pool } from '../db/pool';
import { normalizeMacAddress } from '../utils/mac';
import { appendTechnicalAudit } from '../services/technicalAudit';

const router = Router();
const DEVICE_TYPES = ['tag', 'b5', 'sensor', 'beacon', 'unknown'] as const;
const DEVICE_STATUSES = ['active', 'inactive', 'maintenance', 'retired', 'unknown'] as const;

const enumValue = <T extends readonly string[]>(values: T, value: unknown): T[number] | undefined =>
  values.includes(value as T[number]) ? value as T[number] : undefined;

const companyIdValue = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' && validateUuid(value) ? value : undefined;
};

const deviceSelect = `SELECT d.id, d.name, d.ble_mac, d.description, d.owner_id, d.company_id,
                             d.device_type, d.status, d.category_id, d.active, d.last_seen_at,
                             d.last_place_id, d.last_gateway_id, d.last_rssi,
                             d.last_temperature_c, d.last_battery_mv,
                             p.name AS place_name, g.name AS gateway_name,
                             c.name AS category_name, co.code AS company_code, co.name AS company_name,
                             d.created_at, d.updated_at
                      FROM devices d
                      LEFT JOIN places p ON p.id = d.last_place_id
                      LEFT JOIN gateways g ON g.id = d.last_gateway_id
                      LEFT JOIN device_categories c ON c.id = d.category_id
                      LEFT JOIN companies co ON co.id = d.company_id`;

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const scope = await resolveHardwareAccess(req.user!, 'read');
    const values: unknown[] = [];
    const predicate = scopedHardwarePredicate({ scope, values, companyColumn: 'd.company_id', ownerColumn: 'd.owner_id' });
    const result = await pool.query(`${deviceSelect} WHERE ${predicate} ORDER BY d.name NULLS LAST, d.id`, values);
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list devices', error);
    return res.status(500).json({ message: 'Failed to list devices' });
  }
});

router.get('/grouped-by-place', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const scope = await resolveHardwareAccess(req.user!, 'read');
    const values: unknown[] = [];
    const predicate = scopedHardwarePredicate({ scope, values, companyColumn: 'd.company_id', ownerColumn: 'd.owner_id' });
    const result = await pool.query(
      `SELECT p.id AS place_id, p.name AS place_name, json_agg(d ORDER BY d.name) AS devices
       FROM (
         SELECT d.id, d.name, d.ble_mac, d.company_id, d.device_type, d.status,
                d.last_seen_at, d.last_rssi, d.last_battery_mv, d.last_temperature_c,
                d.last_place_id, d.owner_id
         FROM devices d WHERE ${predicate}
       ) d
       LEFT JOIN places p ON p.id = d.last_place_id
       GROUP BY p.id, p.name ORDER BY p.name`, values
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to group devices', error);
    return res.status(500).json({ message: 'Failed to group devices' });
  }
});

router.get('/by-mac/:mac', authenticate, async (req: AuthenticatedRequest, res) => {
  const mac = normalizeMacAddress(req.params.mac);
  if (!mac) return res.status(400).json({ message: 'BLE MAC is invalid' });
  try {
    const scope = await resolveHardwareAccess(req.user!, 'read');
    const values: unknown[] = [mac];
    const predicate = scopedHardwarePredicate({ scope, values, companyColumn: 'd.company_id', ownerColumn: 'd.owner_id' });
    const result = await pool.query(`${deviceSelect} WHERE d.ble_mac = $1 AND ${predicate}`, values);
    if (!result.rows[0]) return res.status(404).json({ message: 'Device not found' });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to get device by MAC', error);
    return res.status(500).json({ message: 'Failed to get device' });
  }
});

router.post('/', authenticate, authorizeHardware('superadmin'), async (req: AuthenticatedRequest, res) => {
  const { name, bleMac, description, ownerId, categoryId } = req.body;
  const normalizedMac = normalizeMacAddress(bleMac);
  if (!normalizedMac) return res.status(400).json({ message: 'BLE MAC is invalid' });
  const companyId = companyIdValue(req.body?.companyId);
  if (req.body?.companyId !== undefined && companyId === undefined) return res.status(400).json({ message: 'companyId is invalid' });
  const deviceType = req.body?.deviceType === undefined ? 'unknown' : enumValue(DEVICE_TYPES, req.body.deviceType);
  const status = req.body?.status === undefined ? 'active' : enumValue(DEVICE_STATUSES, req.body.status);
  if (!deviceType || !status) return res.status(400).json({ message: 'Invalid deviceType or status' });
  const ownerValue = ownerId === undefined || ownerId === null || ownerId === '' ? null : Number(ownerId);
  const categoryValue = categoryId === undefined || categoryId === null || categoryId === '' ? null : Number(categoryId);
  if ((ownerValue !== null && !Number.isInteger(ownerValue)) || (categoryValue !== null && !Number.isInteger(categoryValue))) {
    return res.status(400).json({ message: 'Invalid ownerId or categoryId' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (companyId) {
      const company = await client.query('SELECT id FROM companies WHERE id = $1 AND active = TRUE', [companyId]);
      if (!company.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Company not found' }); }
    }
    const result = await client.query(
      `INSERT INTO devices(name, ble_mac, description, owner_id, category_id, company_id, device_type, status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, name, ble_mac, description, owner_id, category_id, company_id, device_type, status, active`,
      [name ? String(name).trim() || null : null, normalizedMac, description ? String(description).trim() || null : null,
       ownerValue, categoryValue, companyId ?? null, deviceType, status]
    );
    const device = result.rows[0];
    await appendTechnicalAudit({ actorUserId: req.user!.id, action: 'device.create', entityType: 'device', entityId: device.id, companyId: device.company_id, requestId: req.requestId, result: 'success', after: device }, client);
    await client.query('COMMIT');
    return res.status(201).json(device);
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') return res.status(409).json({ message: 'Device already exists' });
    console.error('Failed to create device', error);
    return res.status(500).json({ message: 'Failed to create device' });
  } finally { client.release(); }
});

router.post('/claim', authenticate, async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== 'USER') return res.status(403).json({ message: 'Forbidden' });
  const normalizedMac = normalizeMacAddress(req.body?.bleMac);
  if (!normalizedMac) return res.status(400).json({ message: 'bleMac is invalid' });
  try {
    const result = await pool.query(
      `UPDATE devices SET owner_id = $1, name = COALESCE($2, name), updated_at = NOW()
       WHERE ble_mac = $3 AND company_id IS NULL AND (owner_id IS NULL OR owner_id = $1)
       RETURNING id, name, ble_mac, owner_id, company_id`,
      [req.user!.id, req.body?.name ? String(req.body.name).trim() || null : null, normalizedMac]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Device not found or already assigned' });
    await appendTechnicalAudit({ actorUserId: req.user!.id, action: 'device.claim', entityType: 'device', entityId: result.rows[0].id, requestId: req.requestId, result: 'success', after: result.rows[0] });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to claim device', error);
    return res.status(500).json({ message: 'Failed to claim device' });
  }
});

router.get('/:deviceId/history', authenticate, async (req: AuthenticatedRequest, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId)) return res.status(400).json({ message: 'Invalid device id' });
  try {
    const scope = await resolveHardwareAccess(req.user!, 'read');
    const values: unknown[] = [deviceId];
    const predicate = scopedHardwarePredicate({ scope, values, companyColumn: 'd.company_id', ownerColumn: 'd.owner_id' });
    const result = await pool.query(
      `SELECT dr.id, dr.recorded_at, dr.updated_at, dr.rssi, dr.adv_type, dr.raw_payload,
              dr.battery_voltage_mv, dr.temperature_c, dr.humidity, dr.movement_count,
              dr.additional_data, g.name AS gateway_name, g.mac_address, p.name AS place_name
       FROM device_records dr
       JOIN devices d ON d.id = dr.device_id
       LEFT JOIN gateways g ON g.id = dr.gateway_id
       LEFT JOIN places p ON p.id = dr.place_id
       WHERE d.id = $1 AND ${predicate}
       ORDER BY dr.recorded_at DESC LIMIT 500`, values
    );
    if (!result.rows.length) {
      const visible = await pool.query(`SELECT 1 FROM devices d WHERE d.id = $1 AND ${predicate}`, values);
      if (!visible.rows[0]) return res.status(404).json({ message: 'Device not found' });
    }
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch device history', error);
    return res.status(500).json({ message: 'Failed to fetch device history' });
  }
});

router.get('/:deviceId', authenticate, async (req: AuthenticatedRequest, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId)) return res.status(400).json({ message: 'Invalid device id' });
  try {
    const scope = await resolveHardwareAccess(req.user!, 'read');
    const values: unknown[] = [deviceId];
    const predicate = scopedHardwarePredicate({ scope, values, companyColumn: 'd.company_id', ownerColumn: 'd.owner_id' });
    const result = await pool.query(`${deviceSelect} WHERE d.id = $1 AND ${predicate}`, values);
    if (!result.rows[0]) return res.status(404).json({ message: 'Device not found' });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to get device', error);
    return res.status(500).json({ message: 'Failed to get device' });
  }
});

router.put('/:deviceId', authenticate, async (req: AuthenticatedRequest, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId)) return res.status(400).json({ message: 'Invalid device id' });
  if (!isHardwareSuperadmin(req.user!.role) && req.user!.role !== 'hardware_technician' && req.user!.role !== 'USER') {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const scope = await resolveHardwareAccess(req.user!, 'technician');
  const accessValues: unknown[] = [deviceId];
  const predicate = scopedHardwarePredicate({ scope, values: accessValues, companyColumn: 'd.company_id', ownerColumn: 'd.owner_id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const beforeResult = await client.query(`SELECT d.* FROM devices d WHERE d.id = $1 AND ${predicate} FOR UPDATE`, accessValues);
    const before = beforeResult.rows[0];
    if (!before) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Device not found' }); }
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [bodyKey, column] of [['name', 'name'], ['description', 'description']] as const) {
      if (req.body?.[bodyKey] !== undefined) {
        values.push(typeof req.body[bodyKey] === 'string' ? req.body[bodyKey].trim() || null : null);
        fields.push(`${column} = $${values.length}`);
      }
    }
    for (const [bodyKey, column] of [['categoryId', 'category_id'], ['lastPlaceId', 'last_place_id']] as const) {
      if (req.body?.[bodyKey] !== undefined) {
        const raw = req.body[bodyKey];
        const parsed = raw === null || raw === '' ? null : Number(raw);
        if (parsed !== null && !Number.isInteger(parsed)) { await client.query('ROLLBACK'); return res.status(400).json({ message: `${bodyKey} is invalid` }); }
        values.push(parsed); fields.push(`${column} = $${values.length}`);
      }
    }
    if (isHardwareSuperadmin(req.user!.role)) {
      if (req.body?.companyId !== undefined) {
        const parsed = companyIdValue(req.body.companyId);
        if (parsed === undefined) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'companyId is invalid' }); }
        if (parsed) {
          const company = await client.query('SELECT id FROM companies WHERE id = $1 AND active = TRUE', [parsed]);
          if (!company.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Company not found' }); }
        }
        values.push(parsed); fields.push(`company_id = $${values.length}`);
      }
      if (req.body?.deviceType !== undefined) {
        const parsed = enumValue(DEVICE_TYPES, req.body.deviceType);
        if (!parsed) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'deviceType is invalid' }); }
        values.push(parsed); fields.push(`device_type = $${values.length}`);
      }
      if (req.body?.status !== undefined) {
        const parsed = enumValue(DEVICE_STATUSES, req.body.status);
        if (!parsed) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'status is invalid' }); }
        values.push(parsed); fields.push(`status = $${values.length}`);
      }
      if (req.body?.active !== undefined) {
        if (typeof req.body.active !== 'boolean') { await client.query('ROLLBACK'); return res.status(400).json({ message: 'active must be boolean' }); }
        values.push(req.body.active); fields.push(`active = $${values.length}`);
      }
      if (req.body?.ownerId !== undefined) {
        const parsed = req.body.ownerId === null || req.body.ownerId === '' ? null : Number(req.body.ownerId);
        if (parsed !== null && !Number.isInteger(parsed)) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'ownerId is invalid' }); }
        values.push(parsed); fields.push(`owner_id = $${values.length}`);
      }
    } else if (['companyId', 'deviceType', 'status', 'active', 'ownerId'].some((key) => req.body?.[key] !== undefined)) {
      await client.query('ROLLBACK'); return res.status(403).json({ message: 'Forbidden' });
    }
    if (!fields.length) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'No updates provided' }); }
    values.push(deviceId);
    const result = await client.query(
      `UPDATE devices SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length}
       RETURNING id, name, ble_mac, description, owner_id, category_id, company_id, device_type, status, active, updated_at`, values
    );
    const after = result.rows[0];
    await appendTechnicalAudit({ actorUserId: req.user!.id, action: 'device.update', entityType: 'device', entityId: deviceId, companyId: after.company_id, requestId: req.requestId, result: 'success', before, after }, client);
    await client.query('COMMIT');
    return res.json(after);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to update device', error);
    return res.status(500).json({ message: 'Failed to update device' });
  } finally { client.release(); }
});

router.post('/:deviceId/assign-category', authenticate, async (req: AuthenticatedRequest, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId)) return res.status(400).json({ message: 'Invalid device id' });
  if (!isHardwareSuperadmin(req.user!.role) && req.user!.role !== 'hardware_technician' && req.user!.role !== 'USER') return res.status(403).json({ message: 'Forbidden' });
  const categoryId = req.body?.categoryId === null || req.body?.categoryId === '' ? null : Number(req.body?.categoryId);
  if (categoryId !== null && !Number.isInteger(categoryId)) return res.status(400).json({ message: 'Invalid categoryId' });
  try {
    const scope = await resolveHardwareAccess(req.user!, 'technician');
    const values: unknown[] = [categoryId, deviceId];
    const predicate = scopedHardwarePredicate({ scope, values, companyColumn: 'd.company_id', ownerColumn: 'd.owner_id' });
    const result = await pool.query(
      `UPDATE devices d SET category_id = $1, updated_at = NOW()
       WHERE d.id = $2 AND ${predicate}
       RETURNING d.id, d.name, d.ble_mac, d.owner_id, d.company_id, d.category_id`, values
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Device not found' });
    await appendTechnicalAudit({ actorUserId: req.user!.id, action: 'device.category.assign', entityType: 'device', entityId: deviceId, companyId: result.rows[0].company_id, requestId: req.requestId, result: 'success', after: result.rows[0] });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to assign category', error);
    return res.status(500).json({ message: 'Failed to assign category' });
  }
});

router.delete('/:deviceId', authenticate, authorizeHardware('superadmin'), async (req: AuthenticatedRequest, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId)) return res.status(400).json({ message: 'Invalid device id' });
  try {
    const result = await pool.query(
      `UPDATE devices SET active = FALSE, status = 'inactive', updated_at = NOW()
       WHERE id = $1 RETURNING id, company_id, active, status`, [deviceId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Device not found' });
    await appendTechnicalAudit({ actorUserId: req.user!.id, action: 'device.deactivate', entityType: 'device', entityId: deviceId, companyId: result.rows[0].company_id, requestId: req.requestId, result: 'success', after: result.rows[0] });
    return res.status(204).send();
  } catch (error) {
    console.error('Failed to deactivate device', error);
    return res.status(500).json({ message: 'Failed to deactivate device' });
  }
});

export default router;
