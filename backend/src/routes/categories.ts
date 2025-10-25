import { Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    let query = `SELECT id, owner_id, name, description, photo_url, created_at, updated_at
                 FROM device_categories`;
    const params: unknown[] = [];
    if (req.user!.role !== 'ADMIN') {
      query += ' WHERE owner_id = $1';
      params.push(req.user!.id);
    }
    query += ' ORDER BY name';
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list categories', error);
    return res.status(500).json({ message: 'Failed to list categories' });
  }
});

router.post('/', authenticate, async (req: AuthenticatedRequest, res) => {
  const { name, description, photoUrl } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Name is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO device_categories (owner_id, name, description, photo_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, owner_id, name, description, photo_url, created_at, updated_at`,
      [req.user!.id, name, description ?? null, photoUrl ?? null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to create category', error);
    return res.status(500).json({ message: 'Failed to create category' });
  }
});

router.put('/:categoryId', authenticate, async (req: AuthenticatedRequest, res) => {
  const categoryId = Number(req.params.categoryId);
  const { name, description, photoUrl } = req.body;
  try {
    const categoryResult = await pool.query('SELECT owner_id FROM device_categories WHERE id = $1', [categoryId]);
    const category = categoryResult.rows[0];
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    if (req.user!.role !== 'ADMIN' && category.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const result = await pool.query(
      `UPDATE device_categories
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           photo_url = COALESCE($3, photo_url),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, owner_id, name, description, photo_url, updated_at`,
      [name ?? null, description ?? null, photoUrl ?? null, categoryId]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to update category', error);
    return res.status(500).json({ message: 'Failed to update category' });
  }
});

router.get('/:categoryId/photos', authenticate, async (req: AuthenticatedRequest, res) => {
  const categoryId = Number(req.params.categoryId);
  try {
    const result = await pool.query(
      `SELECT id, category_id, title, image_data, created_at
       FROM category_photos
       WHERE category_id = $1
       ORDER BY created_at DESC`,
      [categoryId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list category photos', error);
    return res.status(500).json({ message: 'Failed to list category photos' });
  }
});

router.post('/:categoryId/photos', authenticate, async (req: AuthenticatedRequest, res) => {
  const categoryId = Number(req.params.categoryId);
  const { title, imageData } = req.body;
  if (!imageData) {
    return res.status(400).json({ message: 'imageData is required' });
  }
  try {
    const categoryResult = await pool.query('SELECT owner_id FROM device_categories WHERE id = $1', [categoryId]);
    const category = categoryResult.rows[0];
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    if (req.user!.role !== 'ADMIN' && category.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const result = await pool.query(
      `INSERT INTO category_photos (category_id, title, image_data, uploaded_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, category_id, title, created_at`,
      [categoryId, title ?? null, imageData, req.user!.id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to upload category photo', error);
    return res.status(500).json({ message: 'Failed to upload category photo' });
  }
});

export default router;
