import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';

export const tagsRouter = Router();

tagsRouter.use(requireAuth);

tagsRouter.post('/', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const { mac, descripcion, physicalAlarmFollowupDelayMs } = req.body;
    const result = await db.query(
      `INSERT INTO tags(tag_uid, model, physical_alarm_followup_delay_ms) VALUES($1,$2,$3) RETURNING *`,
      [String(mac).toLowerCase(), descripcion ?? null, physicalAlarmFollowupDelayMs ?? 45000]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) { next(e); }
});

tagsRouter.get('/', async (_req, res, next) => {
  try {
    const result = await db.query(
      `SELECT t.*, (SELECT battery FROM presence_events p WHERE p.tag_uid = t.tag_uid AND battery IS NOT NULL ORDER BY event_ts DESC LIMIT 1) as last_battery
       FROM tags t ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (e) { next(e); }
});

tagsRouter.patch('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE tags SET tag_uid = COALESCE($2, tag_uid), model = COALESCE($3, model), active = COALESCE($4, active), physical_alarm_followup_delay_ms = COALESCE($5, physical_alarm_followup_delay_ms), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.mac ? String(req.body.mac).toLowerCase() : null, req.body.descripcion ?? null, req.body.active ?? null, req.body.physicalAlarmFollowupDelayMs ?? null]
    );
    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

tagsRouter.delete('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const tag = await db.query<{ tag_uid: string }>('SELECT tag_uid FROM tags WHERE id = $1', [req.params.id]);
    if (!tag.rowCount) return res.status(404).json({ error: 'not_found' });

    const deps = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM worker_tag_assignments WHERE tag_id = $1) AS assignments,
         (SELECT COUNT(*)::int FROM cold_room_sessions WHERE tag_id = $1) AS sessions,
         (SELECT COUNT(*)::int FROM alerts WHERE tag_id = $1) AS alerts,
         (SELECT COUNT(*)::int FROM incidents WHERE tag_id = $1) AS incidents,
         (SELECT COUNT(*)::int FROM tag_commands WHERE tag_id = $1) AS tag_commands,
         (SELECT COUNT(*)::int FROM ble_alarm_sessions WHERE tag_id = $1) AS ble_sessions,
         (SELECT COUNT(*)::int FROM presence_events WHERE tag_uid = $2) AS presence_events`,
      [req.params.id, tag.rows[0].tag_uid]
    );

    const row = deps.rows[0] as Record<string, number>;
    const blocked = Object.entries(row).filter(([, count]) => Number(count) > 0).map(([name, count]) => ({ relation: name, count }));
    if (blocked.length) {
      return res.status(409).json({
        error: 'dependency_conflict',
        entity: 'tag',
        dependencies: blocked,
        message: `No se puede borrar el tag porque está vinculado a: ${blocked.map((d) => `${d.relation} (${d.count})`).join(', ')}`
      });
    }

    await db.query('DELETE FROM tags WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (e) { next(e); }
});
