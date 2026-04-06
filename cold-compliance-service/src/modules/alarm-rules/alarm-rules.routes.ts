import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';

export const alarmRulesRouter = Router();
alarmRulesRouter.use(requireAuth);

alarmRulesRouter.get('/', requireRoles(['superadministrador']), async (_req, res, next) => {
  try {
    const result = await db.query(
      `SELECT r.*,
              CASE
                WHEN EXISTS (
                  SELECT 1 FROM alerts a
                  WHERE a.acknowledged_at IS NULL
                    AND (a.alert_type IN ('alarm_rule_warning','alarm_rule_alarm'))
                    AND a.metadata @> jsonb_build_object('ruleId', r.id)::jsonb
                ) THEN 'activa'
                WHEN r.active = true THEN 'encendida'
                ELSE 'apagada'
              END AS operational_status
       FROM alarm_rules r
       ORDER BY r.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

alarmRulesRouter.post('/', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const { descripcion, minutosBuzzerShaker, minutosAlarma, minutosGraciaFuera, active } = req.body;
    const result = await db.query(
      `INSERT INTO alarm_rules(description, buzzer_shaker_minutes, alarm_minutes, alarm_visibility_grace_minutes, active)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [descripcion, minutosBuzzerShaker, minutosAlarma, minutosGraciaFuera ?? 15, active ?? true]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

alarmRulesRouter.patch('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const { descripcion, minutosBuzzerShaker, minutosAlarma, minutosGraciaFuera, active } = req.body;
    const result = await db.query(
      `UPDATE alarm_rules
       SET description = COALESCE($2, description),
           buzzer_shaker_minutes = COALESCE($3, buzzer_shaker_minutes),
           alarm_minutes = COALESCE($4, alarm_minutes),
           alarm_visibility_grace_minutes = COALESCE($5, alarm_visibility_grace_minutes),
           active = COALESCE($6, active),
           updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, descripcion ?? null, minutosBuzzerShaker ?? null, minutosAlarma ?? null, minutosGraciaFuera ?? null, active ?? null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

alarmRulesRouter.delete('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const deps = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM alerts WHERE metadata @> jsonb_build_object('ruleId', $1)::jsonb) AS alerts`,
      [req.params.id]
    );

    const alertsCount = Number(deps.rows[0]?.alerts ?? 0);
    if (alertsCount > 0) {
      return res.status(409).json({
        error: 'dependency_conflict',
        entity: 'alarm_rule',
        dependencies: [{ relation: 'alerts', count: alertsCount }],
        message: `No se puede borrar la regla porque está vinculada a alertas (${alertsCount})`
      });
    }

    await db.query('DELETE FROM alarm_rules WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
