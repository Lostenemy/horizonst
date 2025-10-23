import { Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    let query = `SELECT m.id, m.topic, m.gateway_mac, m.payload, m.received_at,
                        g.id AS gateway_id, g.name AS gateway_name,
                        p.id AS place_id, p.name AS place_name
                 FROM mqtt_messages m
                 LEFT JOIN gateways g ON g.mac_address = m.gateway_mac
                 LEFT JOIN gateway_places gp ON gp.gateway_id = g.id AND gp.active = true
                 LEFT JOIN places p ON p.id = gp.place_id`;
    const params: unknown[] = [];
    if (req.user!.role !== 'ADMIN') {
      query += ' WHERE g.owner_id = $1 OR p.owner_id = $1';
      params.push(req.user!.id);
    }
    query += ' ORDER BY m.received_at DESC LIMIT 200';
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch MQTT messages', error);
    return res.status(500).json({ message: 'Failed to fetch MQTT messages' });
  }
});

export default router;
