import { Router } from 'express';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { pool } from '../db/pool';
import { normalizeMacAddress } from '../utils/mac';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    let query = `SELECT g.id, g.name, g.mac_address, g.description, g.owner_id, g.active,
                        gp.place_id, p.name AS place_name, g.created_at, g.updated_at
                 FROM gateways g
                 LEFT JOIN gateway_places gp ON gp.gateway_id = g.id AND gp.active = true
                 LEFT JOIN places p ON p.id = gp.place_id`;
    const params: unknown[] = [];
    if (req.user!.role !== 'ADMIN') {
      query += ' WHERE g.owner_id = $1 OR p.owner_id = $1';
      params.push(req.user!.id);
    }

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list gateways', error);
    return res.status(500).json({ message: 'Failed to list gateways' });
  }
});

router.post('/', authenticate, authorize(['ADMIN']), async (req, res) => {
  const { name, macAddress, description, ownerId } = req.body;
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) {
    return res.status(400).json({ message: 'MAC address is invalid' });
  }
  const ownerValue = ownerId === undefined || ownerId === null || ownerId === '' ? null : Number(ownerId);
  if (ownerValue !== null && Number.isNaN(ownerValue)) {
    return res.status(400).json({ message: 'ownerId must be a number' });
  }
  try {
    const existing = await pool.query('SELECT id FROM gateways WHERE mac_address = $1', [normalizedMac]);
    if ((existing.rowCount ?? 0) > 0) {
      return res.status(409).json({ message: 'Gateway already exists' });
    }
    const result = await pool.query(
      `INSERT INTO gateways (name, mac_address, description, owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, mac_address, description, owner_id, active`,
      [name ? String(name).trim() || null : null, normalizedMac, description ? String(description).trim() || null : null, ownerValue]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to create gateway', error);
    return res.status(500).json({ message: 'Failed to create gateway' });
  }
});

router.post('/:gatewayId/assign-place', authenticate, async (req: AuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  const { placeId } = req.body;

  if (Number.isNaN(gatewayId)) {
    return res.status(400).json({ message: 'Invalid gateway id' });
  }

  try {
    const gatewayResult = await pool.query('SELECT owner_id FROM gateways WHERE id = $1 AND active = true', [gatewayId]);
    const gateway = gatewayResult.rows[0];
    if (!gateway) {
      return res.status(404).json({ message: 'Gateway not found' });
    }

    if (placeId === undefined || placeId === null || placeId === '') {
      await pool.query('UPDATE gateway_places SET active = false WHERE gateway_id = $1', [gatewayId]);
      return res.status(200).json({ gateway_id: gatewayId, place_id: null });
    }

    const parsedPlaceId = Number(placeId);
    if (Number.isNaN(parsedPlaceId)) {
      return res.status(400).json({ message: 'placeId must be a number' });
    }

    const placeResult = await pool.query('SELECT owner_id FROM places WHERE id = $1', [parsedPlaceId]);
    const place = placeResult.rows[0];
    if (!place) {
      return res.status(404).json({ message: 'Place not found' });
    }

    if (req.user!.role !== 'ADMIN' && place.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await pool.query('UPDATE gateway_places SET active = false WHERE gateway_id = $1', [gatewayId]);
    const result = await pool.query(
      `INSERT INTO gateway_places (gateway_id, place_id, assigned_by)
       VALUES ($1, $2, $3)
       RETURNING gateway_id, place_id, assigned_at`,
      [gatewayId, parsedPlaceId, req.user!.id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to assign gateway', error);
    return res.status(500).json({ message: 'Failed to assign gateway' });
  }
});

router.put('/:gatewayId', authenticate, async (req: AuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  if (Number.isNaN(gatewayId)) {
    return res.status(400).json({ message: 'Invalid gateway id' });
  }

  const { name, description, ownerId, active } = req.body;

  try {
    const gatewayResult = await pool.query('SELECT owner_id FROM gateways WHERE id = $1', [gatewayId]);
    const gateway = gatewayResult.rows[0];
    if (!gateway) {
      return res.status(404).json({ message: 'Gateway not found' });
    }
    if (req.user!.role !== 'ADMIN' && gateway.owner_id !== req.user!.id) {
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
    if (active !== undefined) {
      let activeValue: boolean;
      if (typeof active === 'string') {
        if (active.toLowerCase() === 'true') {
          activeValue = true;
        } else if (active.toLowerCase() === 'false') {
          activeValue = false;
        } else {
          return res.status(400).json({ message: 'active must be true or false' });
        }
      } else {
        activeValue = Boolean(active);
      }
      fields.push(`active = $${index++}`);
      values.push(activeValue);
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

    if (!fields.length) {
      return res.status(400).json({ message: 'No updates provided' });
    }

    const setClause = [...fields, 'updated_at = NOW()'].join(', ');
    const result = await pool.query(
      `UPDATE gateways
       SET ${setClause}
       WHERE id = $${index}
       RETURNING id, name, mac_address, description, owner_id, active, updated_at`,
      [...values, gatewayId]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to update gateway', error);
    return res.status(500).json({ message: 'Failed to update gateway' });
  }
});

router.delete('/:gatewayId', authenticate, async (req: AuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  if (Number.isNaN(gatewayId)) {
    return res.status(400).json({ message: 'Invalid gateway id' });
  }

  try {
    const gatewayResult = await pool.query('SELECT owner_id FROM gateways WHERE id = $1', [gatewayId]);
    const gateway = gatewayResult.rows[0];
    if (!gateway) {
      return res.status(404).json({ message: 'Gateway not found' });
    }
    if (req.user!.role !== 'ADMIN' && gateway.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await pool.query('DELETE FROM gateways WHERE id = $1', [gatewayId]);
    return res.status(204).send();
  } catch (error) {
    console.error('Failed to delete gateway', error);
    return res.status(500).json({ message: 'Failed to delete gateway' });
  }
});

export default router;
