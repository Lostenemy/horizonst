import { Router } from 'express';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { pool } from '../db/pool';
import { normalizeMacAddress } from '../utils/mac';

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
  const normalizedMac = normalizeMacAddress(bleMac);
  if (!normalizedMac) {
    return res.status(400).json({ message: 'BLE MAC is invalid' });
  }
  const ownerValue = ownerId === undefined || ownerId === null || ownerId === '' ? null : Number(ownerId);
  if (ownerValue !== null && Number.isNaN(ownerValue)) {
    return res.status(400).json({ message: 'ownerId must be a number' });
  }
  const categoryValue = categoryId === undefined || categoryId === null || categoryId === '' ? null : Number(categoryId);
  if (categoryValue !== null && Number.isNaN(categoryValue)) {
    return res.status(400).json({ message: 'categoryId must be a number' });
  }
  try {
    const existing = await pool.query('SELECT id FROM devices WHERE ble_mac = $1', [normalizedMac]);
    if ((existing.rowCount ?? 0) > 0) {
      return res.status(409).json({ message: 'Device already exists' });
    }
    const result = await pool.query(
      `INSERT INTO devices (name, ble_mac, description, owner_id, category_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, ble_mac, owner_id, category_id, description`,
      [
        name ? String(name).trim() || null : null,
        normalizedMac,
        description ? String(description).trim() || null : null,
        ownerValue,
        categoryValue
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to create device', error);
    return res.status(500).json({ message: 'Failed to create device' });
  }
});

router.post('/claim', authenticate, async (req: AuthenticatedRequest, res) => {
  const { bleMac, name } = req.body;
  const normalizedMac = normalizeMacAddress(bleMac);
  if (!normalizedMac) {
    return res.status(400).json({ message: 'bleMac is invalid' });
  }

  try {
    const result = await pool.query('SELECT id, owner_id FROM devices WHERE ble_mac = $1', [normalizedMac]);
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
      [req.user!.id, name ? String(name).trim() || null : null, device.id]
    );

    return res.json(update.rows[0]);
  } catch (error) {
    console.error('Failed to claim device', error);
    return res.status(500).json({ message: 'Failed to claim device' });
  }
});

router.put('/:deviceId', authenticate, async (req: AuthenticatedRequest, res) => {
  const deviceId = Number(req.params.deviceId);
  if (Number.isNaN(deviceId)) {
    return res.status(400).json({ message: 'Invalid device id' });
  }

  const { name, description, ownerId, categoryId, lastPlaceId } = req.body;

  try {
    const deviceResult = await pool.query('SELECT owner_id FROM devices WHERE id = $1', [deviceId]);
    const device = deviceResult.rows[0];
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }
    if (req.user!.role !== 'ADMIN' && device.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (name !== undefined) {
      const trimmed = typeof name === 'string' ? name.trim() : '';
      fields.push(`name = $${index++}`);
      values.push(trimmed.length ? trimmed : null);
    }
    if (description !== undefined) {
      const trimmed = typeof description === 'string' ? description.trim() : '';
      fields.push(`description = $${index++}`);
      values.push(trimmed.length ? trimmed : null);
    }
    if (categoryId !== undefined) {
      if (categoryId === null || categoryId === '') {
        fields.push(`category_id = $${index++}`);
        values.push(null);
      } else {
        const parsed = Number(categoryId);
        if (Number.isNaN(parsed)) {
          return res.status(400).json({ message: 'Invalid categoryId' });
        }
        fields.push(`category_id = $${index++}`);
        values.push(parsed);
      }
    }
    if (lastPlaceId !== undefined) {
      if (lastPlaceId === null || lastPlaceId === '') {
        fields.push(`last_place_id = $${index++}`);
        values.push(null);
      } else {
        const parsed = Number(lastPlaceId);
        if (Number.isNaN(parsed)) {
          return res.status(400).json({ message: 'Invalid lastPlaceId' });
        }
        fields.push(`last_place_id = $${index++}`);
        values.push(parsed);
      }
    }
    if (ownerId !== undefined) {
      if (req.user!.role !== 'ADMIN') {
        return res.status(403).json({ message: 'Forbidden' });
      }
      if (ownerId === null || ownerId === '') {
        fields.push(`owner_id = $${index++}`);
        values.push(null);
      } else {
        const parsed = Number(ownerId);
        if (Number.isNaN(parsed)) {
          return res.status(400).json({ message: 'Invalid ownerId' });
        }
        fields.push(`owner_id = $${index++}`);
        values.push(parsed);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No updates provided' });
    }

    const setClause = [...fields, 'updated_at = NOW()'].join(', ');
    const result = await pool.query(
      `UPDATE devices
       SET ${setClause}
       WHERE id = $${index}
       RETURNING id, name, ble_mac, owner_id, category_id, description, last_place_id, updated_at`,
      [...values, deviceId]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to update device', error);
    return res.status(500).json({ message: 'Failed to update device' });
  }
});

router.delete('/:deviceId', authenticate, async (req: AuthenticatedRequest, res) => {
  const deviceId = Number(req.params.deviceId);
  if (Number.isNaN(deviceId)) {
    return res.status(400).json({ message: 'Invalid device id' });
  }

  try {
    const deviceResult = await pool.query('SELECT owner_id FROM devices WHERE id = $1', [deviceId]);
    const device = deviceResult.rows[0];
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }
    if (req.user!.role !== 'ADMIN' && device.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await pool.query('DELETE FROM devices WHERE id = $1', [deviceId]);
    return res.status(204).send();
  } catch (error) {
    console.error('Failed to delete device', error);
    return res.status(500).json({ message: 'Failed to delete device' });
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
