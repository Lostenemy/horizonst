import { Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    let query = `SELECT id, owner_id, name, description, photo_url, created_at, updated_at
                 FROM places`;
    const params: unknown[] = [];
    if (req.user!.role !== 'ADMIN') {
      query += ' WHERE owner_id = $1';
      params.push(req.user!.id);
    }
    query += ' ORDER BY name';
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list places', error);
    return res.status(500).json({ message: 'Failed to list places' });
  }
});

router.post('/', authenticate, async (req: AuthenticatedRequest, res) => {
  const { name, description, photoUrl } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Name is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO places (owner_id, name, description, photo_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, owner_id, name, description, photo_url, created_at, updated_at`,
      [req.user!.id, name, description ?? null, photoUrl ?? null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to create place', error);
    return res.status(500).json({ message: 'Failed to create place' });
  }
});

router.put('/:placeId', authenticate, async (req: AuthenticatedRequest, res) => {
  const placeId = Number(req.params.placeId);
  const { name, description, photoUrl } = req.body;
  try {
    const placeResult = await pool.query('SELECT owner_id FROM places WHERE id = $1', [placeId]);
    const place = placeResult.rows[0];
    if (!place) {
      return res.status(404).json({ message: 'Place not found' });
    }
    if (req.user!.role !== 'ADMIN' && place.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const result = await pool.query(
      `UPDATE places
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           photo_url = COALESCE($3, photo_url),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, owner_id, name, description, photo_url, updated_at`,
      [name ?? null, description ?? null, photoUrl ?? null, placeId]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to update place', error);
    return res.status(500).json({ message: 'Failed to update place' });
  }
});

router.get('/:placeId/photos', authenticate, async (req: AuthenticatedRequest, res) => {
  const placeId = Number(req.params.placeId);
  try {
    const result = await pool.query(
      `SELECT id, place_id, title, image_data, created_at
       FROM place_photos
       WHERE place_id = $1
       ORDER BY created_at DESC`,
      [placeId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list place photos', error);
    return res.status(500).json({ message: 'Failed to list place photos' });
  }
});

router.post('/:placeId/photos', authenticate, async (req: AuthenticatedRequest, res) => {
  const placeId = Number(req.params.placeId);
  const { title, imageData } = req.body;
  if (!imageData) {
    return res.status(400).json({ message: 'imageData is required' });
  }
  try {
    const placeResult = await pool.query('SELECT owner_id FROM places WHERE id = $1', [placeId]);
    const place = placeResult.rows[0];
    if (!place) {
      return res.status(404).json({ message: 'Place not found' });
    }
    if (req.user!.role !== 'ADMIN' && place.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const result = await pool.query(
      `INSERT INTO place_photos (place_id, title, image_data, uploaded_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, place_id, title, created_at`,
      [placeId, title ?? null, imageData, req.user!.id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to upload place photo', error);
    return res.status(500).json({ message: 'Failed to upload place photo' });
  }
});

export default router;
