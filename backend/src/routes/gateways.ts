import { Router } from 'express';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { pool } from '../db/pool';

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
  if (!macAddress) {
    return res.status(400).json({ message: 'MAC address is required' });
  }
  try {
    const existing = await pool.query('SELECT id FROM gateways WHERE mac_address = $1', [macAddress]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ message: 'Gateway already exists' });
    }
    const result = await pool.query(
      `INSERT INTO gateways (name, mac_address, description, owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, mac_address, description, owner_id, active`,
      [name ?? null, macAddress.toUpperCase(), description ?? null, ownerId ?? null]
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
  if (!placeId) {
    return res.status(400).json({ message: 'placeId is required' });
  }

  try {
    const gatewayResult = await pool.query('SELECT owner_id FROM gateways WHERE id = $1 AND active = true', [gatewayId]);
    const gateway = gatewayResult.rows[0];
    if (!gateway) {
      return res.status(404).json({ message: 'Gateway not found' });
    }

    const placeResult = await pool.query('SELECT owner_id FROM places WHERE id = $1', [placeId]);
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
      [gatewayId, placeId, req.user!.id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to assign gateway', error);
    return res.status(500).json({ message: 'Failed to assign gateway' });
  }
});

export default router;
