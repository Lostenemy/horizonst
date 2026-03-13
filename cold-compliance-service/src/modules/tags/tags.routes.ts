import { Router } from 'express';
import { db } from '../../db/pool';

export const tagsRouter = Router();

tagsRouter.post('/', async (req, res, next) => {
  try {
    const { tagUid, model } = req.body;
    const result = await db.query(`INSERT INTO tags(tag_uid, model) VALUES($1,$2) RETURNING *`, [tagUid.toLowerCase(), model ?? null]);
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

