import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';

export const alarmRulesRouter = Router();
alarmRulesRouter.use(requireAuth);

alarmRulesRouter.get('/', async (_req, res, next) => {
  try {
    res.json((await db.query('SELECT * FROM alarm_rules ORDER BY created_at DESC')).rows);
  } catch (error) {
    next(error);
  }
});

alarmRulesRouter.post('/', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const { descripcion, minutosBuzzerShaker, minutosAlarma, active } = req.body;
    const result = await db.query(
      `INSERT INTO alarm_rules(description, buzzer_shaker_minutes, alarm_minutes, active)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [descripcion, minutosBuzzerShaker, minutosAlarma, active ?? true]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

alarmRulesRouter.patch('/:id', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const { descripcion, minutosBuzzerShaker, minutosAlarma, active } = req.body;
    const result = await db.query(
      `UPDATE alarm_rules
       SET description = COALESCE($2, description),
           buzzer_shaker_minutes = COALESCE($3, buzzer_shaker_minutes),
           alarm_minutes = COALESCE($4, alarm_minutes),
           active = COALESCE($5, active),
           updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, descripcion ?? null, minutosBuzzerShaker ?? null, minutosAlarma ?? null, active ?? null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

alarmRulesRouter.delete('/:id', requireRoles(['supervisor', 'administrador', 'superadministrador']), async (req, res, next) => {
  try {
    await db.query('DELETE FROM alarm_rules WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
