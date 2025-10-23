import { Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.get('/configs', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    let query = `SELECT ac.id, ac.owner_id, ac.name, ac.description, ac.threshold_seconds,
                        ac.device_id, ac.category_id, ac.place_id, ac.handler_group_id, ac.active,
                        ac.created_at, ac.updated_at
                 FROM alarm_configs ac`;
    const params: unknown[] = [];
    if (req.user!.role !== 'ADMIN') {
      query += ' WHERE ac.owner_id = $1';
      params.push(req.user!.id);
    }
    query += ' ORDER BY ac.name';
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list alarm configs', error);
    return res.status(500).json({ message: 'Failed to list alarm configs' });
  }
});

router.post('/configs', authenticate, async (req: AuthenticatedRequest, res) => {
  const { name, description, thresholdSeconds, deviceId, categoryId, placeId, handlerGroupId } = req.body;
  if (!name || !thresholdSeconds) {
    return res.status(400).json({ message: 'name and thresholdSeconds are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO alarm_configs (owner_id, name, description, threshold_seconds, device_id, category_id, place_id, handler_group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, owner_id, name, description, threshold_seconds, device_id, category_id, place_id, handler_group_id, active`,
      [
        req.user!.id,
        name,
        description ?? null,
        thresholdSeconds,
        deviceId ?? null,
        categoryId ?? null,
        placeId ?? null,
        handlerGroupId ?? null
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to create alarm config', error);
    return res.status(500).json({ message: 'Failed to create alarm config' });
  }
});

router.put('/configs/:configId', authenticate, async (req: AuthenticatedRequest, res) => {
  const configId = Number(req.params.configId);
  const { name, description, thresholdSeconds, active, handlerGroupId } = req.body;
  try {
    const configResult = await pool.query('SELECT owner_id FROM alarm_configs WHERE id = $1', [configId]);
    const config = configResult.rows[0];
    if (!config) {
      return res.status(404).json({ message: 'Config not found' });
    }
    if (req.user!.role !== 'ADMIN' && config.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const result = await pool.query(
      `UPDATE alarm_configs
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           threshold_seconds = COALESCE($3, threshold_seconds),
           active = COALESCE($4, active),
           handler_group_id = COALESCE($5, handler_group_id),
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, owner_id, name, description, threshold_seconds, handler_group_id, active, updated_at`,
      [name ?? null, description ?? null, thresholdSeconds ?? null, active ?? null, handlerGroupId ?? null, configId]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to update alarm config', error);
    return res.status(500).json({ message: 'Failed to update alarm config' });
  }
});

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    let query = `SELECT a.id, a.device_id, a.alarm_config_id, a.triggered_at, a.resolved_at,
                        a.status, a.notes, a.breach_seconds, a.updated_at,
                        d.name AS device_name, d.ble_mac,
                        ac.name AS config_name, ac.owner_id
                 FROM alarms a
                 INNER JOIN alarm_configs ac ON ac.id = a.alarm_config_id
                 INNER JOIN devices d ON d.id = a.device_id`;
    const params: unknown[] = [];
    if (req.user!.role !== 'ADMIN') {
      query += ' WHERE ac.owner_id = $1 OR EXISTS (SELECT 1 FROM user_group_members m WHERE m.group_id = ac.handler_group_id AND m.user_id = $1)';
      params.push(req.user!.id);
    }
    query += ' ORDER BY a.triggered_at DESC LIMIT 500';
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list alarms', error);
    return res.status(500).json({ message: 'Failed to list alarms' });
  }
});

router.post('/:alarmId/acknowledge', authenticate, async (req: AuthenticatedRequest, res) => {
  const alarmId = Number(req.params.alarmId);
  try {
    const alarmResult = await pool.query(
      `SELECT a.id, ac.owner_id, ac.handler_group_id
       FROM alarms a
       INNER JOIN alarm_configs ac ON ac.id = a.alarm_config_id
       WHERE a.id = $1`,
      [alarmId]
    );
    const alarm = alarmResult.rows[0];
    if (!alarm) {
      return res.status(404).json({ message: 'Alarm not found' });
    }

    if (req.user!.role !== 'ADMIN') {
      let allowed = alarm.owner_id === req.user!.id;
      if (!allowed && alarm.handler_group_id) {
        const membership = await pool.query(
          `SELECT 1 FROM user_group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
          [alarm.handler_group_id, req.user!.id]
        );
        allowed = (membership.rowCount || 0) > 0;
      }
    if (!allowed) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    }

    const result = await pool.query(
      `UPDATE alarms
       SET status = 'ACKNOWLEDGED', updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, updated_at`,
      [alarmId]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to acknowledge alarm', error);
    return res.status(500).json({ message: 'Failed to acknowledge alarm' });
  }
});

router.post('/:alarmId/resolve', authenticate, async (req: AuthenticatedRequest, res) => {
  const alarmId = Number(req.params.alarmId);
  const { notes } = req.body;
  try {
    const alarmResult = await pool.query(
      `SELECT a.id, ac.owner_id, ac.handler_group_id
       FROM alarms a
       INNER JOIN alarm_configs ac ON ac.id = a.alarm_config_id
       WHERE a.id = $1`,
      [alarmId]
    );
    const alarm = alarmResult.rows[0];
    if (!alarm) {
      return res.status(404).json({ message: 'Alarm not found' });
    }

    if (req.user!.role !== 'ADMIN') {
      let allowed = alarm.owner_id === req.user!.id;
      if (!allowed && alarm.handler_group_id) {
        const membership = await pool.query(
          `SELECT 1 FROM user_group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
          [alarm.handler_group_id, req.user!.id]
        );
        allowed = (membership.rowCount || 0) > 0;
      }
    if (!allowed) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    }

    const result = await pool.query(
      `UPDATE alarms
       SET status = 'RESOLVED', resolved_at = NOW(), updated_at = NOW(), notes = COALESCE($2, notes)
       WHERE id = $1
       RETURNING id, status, resolved_at, updated_at, notes`,
      [alarmId, notes ?? null]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to resolve alarm', error);
    return res.status(500).json({ message: 'Failed to resolve alarm' });
  }
});

export default router;
