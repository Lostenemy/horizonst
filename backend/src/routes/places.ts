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
  if (Number.isNaN(placeId)) {
    return res.status(400).json({ message: 'Invalid place id' });
  }
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

    const fields: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (name !== undefined) {
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (!trimmed.length) {
        return res.status(400).json({ message: 'Name cannot be empty' });
      }
      fields.push(`name = $${index++}`);
      values.push(trimmed);
    }
    if (description !== undefined) {
      const trimmed = typeof description === 'string' ? description.trim() : '';
      fields.push(`description = $${index++}`);
      values.push(trimmed.length ? trimmed : null);
    }
    if (photoUrl !== undefined) {
      const trimmed = typeof photoUrl === 'string' ? photoUrl.trim() : '';
      fields.push(`photo_url = $${index++}`);
      values.push(trimmed.length ? trimmed : null);
    }

    if (!fields.length) {
      return res.status(400).json({ message: 'No updates provided' });
    }

    const setClause = [...fields, 'updated_at = NOW()'].join(', ');
    const result = await pool.query(
      `UPDATE places
       SET ${setClause}
       WHERE id = $${index}
       RETURNING id, owner_id, name, description, photo_url, updated_at`,
      [...values, placeId]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to update place', error);
    return res.status(500).json({ message: 'Failed to update place' });
  }
});

router.delete('/:placeId', authenticate, async (req: AuthenticatedRequest, res) => {
  const placeId = Number(req.params.placeId);
  if (Number.isNaN(placeId)) {
    return res.status(400).json({ message: 'Invalid place id' });
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

    await pool.query('DELETE FROM places WHERE id = $1', [placeId]);
    return res.status(204).send();
  } catch (error) {
    console.error('Failed to delete place', error);
    return res.status(500).json({ message: 'Failed to delete place' });
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
