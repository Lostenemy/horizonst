import { Router } from 'express';
import { db } from '../../db/pool';

export const camerasRouter = Router();

camerasRouter.post('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `INSERT INTO cold_rooms(plant_id, code, name, target_temperature, max_continuous_minutes, pre_alert_minutes, required_break_minutes, max_daily_minutes, dead_man_enabled, dead_man_minutes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        req.body.plantId,
        req.body.code,
        req.body.name,
        req.body.targetTemperature,
        req.body.maxContinuousMinutes,
        req.body.preAlertMinutes,
        req.body.requiredBreakMinutes,
        req.body.maxDailyMinutes,
        req.body.deadManEnabled ?? false,
        req.body.deadManMinutes ?? 3
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) { next(e); }
});

camerasRouter.get('/', async (_req, res, next) => {
  try { res.json((await db.query('SELECT * FROM cold_rooms ORDER BY created_at DESC')).rows); } catch (e) { next(e); }
});
