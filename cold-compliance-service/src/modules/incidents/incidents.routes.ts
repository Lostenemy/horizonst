import { Router } from 'express';
import { db } from '../../db/pool';

export const incidentsRouter = Router();

incidentsRouter.get('/', async (_req, res, next) => {
  try { res.json((await db.query('SELECT * FROM incidents ORDER BY created_at DESC')).rows); } catch (e) { next(e); }
});

incidentsRouter.post('/:id/notes', async (req, res, next) => {
  try {
    const result = await db.query(
      `INSERT INTO incident_notes(incident_id, author_user, note)
       VALUES($1, $2, $3) RETURNING *`,
      [req.params.id, req.body.authorUser, req.body.note]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) { next(e); }
});

incidentsRouter.post('/:id/close', async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE incidents SET status='closed', closed_at = NOW(), closed_by = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, req.body.closedBy]
    );
    res.json(result.rows[0]);
  } catch (e) { next(e); }
});
