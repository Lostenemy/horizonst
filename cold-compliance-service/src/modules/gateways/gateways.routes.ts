import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';
import { mqttPublish } from '../mqtt/mqtt.service';

export const gatewaysRouter = Router();
gatewaysRouter.use(requireAuth);

const rssiThresholdSchema = z.number().int().min(-127).max(0);

const gatewayPayloadSchema = z.object({
  mac: z.string().min(1).optional(),
  descripcion: z.string().optional().nullable(),
  rssiThreshold: rssiThresholdSchema.optional(),
  rssi_threshold: rssiThresholdSchema.optional()
});

const applyRssiSchema = z.object({
  rssi: rssiThresholdSchema.optional(),
  rssiThreshold: rssiThresholdSchema.optional(),
  rssi_threshold: rssiThresholdSchema.optional()
});

function normalizeRssiThreshold(input: { rssiThreshold?: number; rssi_threshold?: number }): number | undefined {
  return input.rssiThreshold ?? input.rssi_threshold;
}

function gatewayTopic(gatewayMac: string): string {
  return env.MQTT_COMMAND_TOPIC_TEMPLATE.replace('{gatewayMac}', gatewayMac.toLowerCase());
}

gatewaysRouter.get('/', async (_req, res, next) => {
  try {
    res.json((await db.query('SELECT * FROM gateways ORDER BY created_at DESC')).rows);
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.post('/', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const parsed = gatewayPayloadSchema.extend({ mac: z.string().min(1) }).parse(req.body);
    const rssiThreshold = normalizeRssiThreshold(parsed) ?? -127;
    const result = await db.query(
      'INSERT INTO gateways(gateway_mac, description, rssi_threshold) VALUES($1,$2,$3) RETURNING *',
      [String(parsed.mac).toLowerCase(), parsed.descripcion ?? null, rssiThreshold]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.patch('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const parsed = gatewayPayloadSchema.parse(req.body);
    const rssiThreshold = normalizeRssiThreshold(parsed);
    const result = await db.query(
      `UPDATE gateways
       SET gateway_mac = COALESCE($2, gateway_mac),
           description = COALESCE($3, description),
           rssi_threshold = COALESCE($4, rssi_threshold)
       WHERE id = $1 RETURNING *`,
      [req.params.id, parsed.mac ? String(parsed.mac).toLowerCase() : null, parsed.descripcion ?? null, rssiThreshold ?? null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.post('/:id/apply-rssi', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const parsed = applyRssiSchema.parse(req.body);
    const gateway = await db.query<{ gateway_mac: string; rssi_threshold: number }>('SELECT gateway_mac, rssi_threshold FROM gateways WHERE id = $1', [req.params.id]);
    if (!gateway.rowCount) return res.status(404).json({ error: 'not_found' });

    const gatewayMac = gateway.rows[0].gateway_mac;
    const rssi = parsed.rssi ?? normalizeRssiThreshold(parsed) ?? gateway.rows[0].rssi_threshold;
    const payload = {
      msg_id: 1042,
      device_info: { mac: gatewayMac.toUpperCase() },
      data: { rssi }
    };
    const topic = gatewayTopic(gatewayMac);

    await mqttPublish(topic, payload);
    res.status(202).json({ ok: true, topic, payload });
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
