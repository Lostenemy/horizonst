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
