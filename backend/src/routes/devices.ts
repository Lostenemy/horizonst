import { Router } from 'express';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    let query = `SELECT d.id, d.name, d.ble_mac, d.description, d.owner_id, d.category_id,
                        d.last_seen_at, d.last_place_id, d.last_gateway_id, d.last_rssi,
                        d.last_temperature_c, d.last_battery_mv,
                        p.name AS place_name, g.name AS gateway_name, c.name AS category_name
                 FROM devices d
                 LEFT JOIN places p ON p.id = d.last_place_id
                 LEFT JOIN gateways g ON g.id = d.last_gateway_id
                 LEFT JOIN device_categories c ON c.id = d.category_id`;
    const params: unknown[] = [];
    if (req.user!.role !== 'ADMIN') {
      query += ' WHERE d.owner_id = $1';
      params.push(req.user!.id);
    }
    query += ' ORDER BY d.name';
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list devices', error);
    return res.status(500).json({ message: 'Failed to list devices' });
  }
});

router.get('/grouped-by-place', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const params: unknown[] = [];
    let filter = '';
    if (req.user!.role !== 'ADMIN') {
      filter = 'WHERE d.owner_id = $1';
      params.push(req.user!.id);
    }
    const result = await pool.query(
      `SELECT p.id AS place_id, p.name AS place_name, json_agg(d.* ORDER BY d.name) AS devices
       FROM (
         SELECT d.id, d.name, d.ble_mac, d.last_seen_at, d.last_rssi, d.last_battery_mv, d.last_temperature_c,
                d.last_place_id, d.owner_id
         FROM devices d
         ${filter}
       ) d
       LEFT JOIN places p ON p.id = d.last_place_id
       GROUP BY p.id, p.name
       ORDER BY p.name`,
      params
    );

    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to group devices', error);
    return res.status(500).json({ message: 'Failed to group devices' });
  }
});

router.post('/', authenticate, authorize(['ADMIN']), async (req, res) => {
  const { name, bleMac, description, ownerId, categoryId } = req.body;
  if (!bleMac) {
    return res.status(400).json({ message: 'BLE MAC is required' });
  }
  try {
    const existing = await pool.query('SELECT id FROM devices WHERE ble_mac = $1', [bleMac]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ message: 'Device already exists' });
    }
    const result = await pool.query(
      `INSERT INTO devices (name, ble_mac, description, owner_id, category_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, ble_mac, owner_id, category_id`,
      [name ?? null, bleMac.toUpperCase(), description ?? null, ownerId ?? null, categoryId ?? null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to create device', error);
    return res.status(500).json({ message: 'Failed to create device' });
  }
});

router.post('/claim', authenticate, async (req: AuthenticatedRequest, res) => {
  const { bleMac, name } = req.body;
  if (!bleMac) {
    return res.status(400).json({ message: 'bleMac is required' });
  }

  try {
    const result = await pool.query('SELECT id, owner_id FROM devices WHERE ble_mac = $1', [bleMac.toUpperCase()]);
    const device = result.rows[0];
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }
    if (device.owner_id && device.owner_id !== req.user!.id) {
      return res.status(409).json({ message: 'Device already assigned' });
    }

    const update = await pool.query(
      `UPDATE devices
       SET owner_id = $1,
           name = COALESCE($2, name),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, ble_mac, owner_id`,
      [req.user!.id, name ?? null, device.id]
    );

    return res.json(update.rows[0]);
  } catch (error) {
    console.error('Failed to claim device', error);
    return res.status(500).json({ message: 'Failed to claim device' });
  }
});

router.post('/:deviceId/assign-category', authenticate, async (req: AuthenticatedRequest, res) => {
  const deviceId = Number(req.params.deviceId);
  const { categoryId } = req.body;
  try {
    const deviceResult = await pool.query('SELECT owner_id FROM devices WHERE id = $1', [deviceId]);
    const device = deviceResult.rows[0];
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }
    if (req.user!.role !== 'ADMIN' && device.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const result = await pool.query(
      `UPDATE devices
       SET category_id = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, ble_mac, owner_id, category_id`,
      [categoryId ?? null, deviceId]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to assign category', error);
    return res.status(500).json({ message: 'Failed to assign category' });
  }
});

router.get('/:deviceId/history', authenticate, async (req: AuthenticatedRequest, res) => {
  const deviceId = Number(req.params.deviceId);
  try {
    const deviceResult = await pool.query('SELECT owner_id FROM devices WHERE id = $1', [deviceId]);
    const device = deviceResult.rows[0];
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }
    if (req.user!.role !== 'ADMIN' && device.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const result = await pool.query(
      `SELECT dr.id, dr.recorded_at, dr.updated_at, dr.rssi, dr.adv_type, dr.raw_payload,
              dr.battery_voltage_mv, dr.temperature_c, dr.humidity, dr.movement_count,
              dr.additional_data, g.name AS gateway_name, g.mac_address, p.name AS place_name
       FROM device_records dr
       LEFT JOIN gateways g ON g.id = dr.gateway_id
       LEFT JOIN places p ON p.id = dr.place_id
       WHERE dr.device_id = $1
       ORDER BY dr.recorded_at DESC
       LIMIT 500`,
      [deviceId]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch device history', error);
    return res.status(500).json({ message: 'Failed to fetch device history' });
  }
});

export default router;
