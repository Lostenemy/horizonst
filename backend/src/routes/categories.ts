import { Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { pool } from '../db/pool';

const router = Router();

const DEFAULT_IMAGE_TYPE = 'image/jpeg';

const buildDataUrl = (imageData: string, mimeType?: string | null) => {
  const safeType = typeof mimeType === 'string' && mimeType.trim().startsWith('image/')
    ? mimeType.trim()
    : DEFAULT_IMAGE_TYPE;
  return `data:${safeType};base64,${imageData}`;
};

type CategoryPhotoRow = {
  id: number;
  category_id: number;
  title: string | null;
  image_data: string;
  mime_type: string | null;
  created_at: string;
};

const mapCategoryPhoto = (row: CategoryPhotoRow) => ({
  id: row.id,
  category_id: row.category_id,
  title: row.title,
  created_at: row.created_at,
  mime_type: row.mime_type,
  image_url: buildDataUrl(row.image_data, row.mime_type)
});

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
  if (Number.isNaN(categoryId)) {
    return res.status(400).json({ message: 'Invalid category id' });
  }
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
      `UPDATE device_categories
       SET ${setClause}
       WHERE id = $${index}
       RETURNING id, owner_id, name, description, photo_url, updated_at`,
      [...values, categoryId]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to update category', error);
    return res.status(500).json({ message: 'Failed to update category' });
  }
});

router.delete('/:categoryId', authenticate, async (req: AuthenticatedRequest, res) => {
  const categoryId = Number(req.params.categoryId);
  if (Number.isNaN(categoryId)) {
    return res.status(400).json({ message: 'Invalid category id' });
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

    await pool.query('DELETE FROM device_categories WHERE id = $1', [categoryId]);
    return res.status(204).send();
  } catch (error) {
    console.error('Failed to delete category', error);
    return res.status(500).json({ message: 'Failed to delete category' });
  }
});

router.get('/photos/library', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    let filter = '';
    const params: unknown[] = [];
    if (req.user!.role !== 'ADMIN') {
      filter = 'WHERE dc.owner_id = $1';
      params.push(req.user!.id);
    }

    const result = await pool.query<CategoryPhotoRow>(
      `SELECT cp.id, cp.category_id, cp.title, cp.image_data, cp.mime_type, cp.created_at
       FROM category_photos cp
       JOIN device_categories dc ON dc.id = cp.category_id
       ${filter}
       ORDER BY cp.created_at DESC`,
      params
    );

    const photos = result.rows.map(mapCategoryPhoto);
    return res.json(photos);
  } catch (error) {
    console.error('Failed to list category photo library', error);
    return res.status(500).json({ message: 'Failed to list category photos' });
  }
});

router.get('/:categoryId/photos', authenticate, async (req: AuthenticatedRequest, res) => {
  const categoryId = Number(req.params.categoryId);
  try {
    const categoryResult = await pool.query('SELECT owner_id FROM device_categories WHERE id = $1', [categoryId]);
    const category = categoryResult.rows[0];
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    if (req.user!.role !== 'ADMIN' && category.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const result = await pool.query<CategoryPhotoRow>(
      `SELECT id, category_id, title, image_data, mime_type, created_at
       FROM category_photos
       WHERE category_id = $1
       ORDER BY created_at DESC`,
      [categoryId]
    );
    const photos = result.rows.map(mapCategoryPhoto);
    return res.json(photos);
  } catch (error) {
    console.error('Failed to list category photos', error);
    return res.status(500).json({ message: 'Failed to list category photos' });
  }
});

router.post('/:categoryId/photos', authenticate, async (req: AuthenticatedRequest, res) => {
  const categoryId = Number(req.params.categoryId);
  const { title, imageData, mimeType } = req.body as {
    title?: string;
    imageData?: unknown;
    mimeType?: unknown;
  };
  if (typeof imageData !== 'string' || !imageData.trim()) {
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

    const safeMime = typeof mimeType === 'string' && mimeType.trim() ? mimeType.trim() : DEFAULT_IMAGE_TYPE;

    const result = await pool.query<CategoryPhotoRow>(
      `INSERT INTO category_photos (category_id, title, image_data, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, category_id, title, created_at, mime_type`,
      [categoryId, title ?? null, imageData, safeMime, req.user!.id]
    );

    const photo = result.rows[0];
    const photoUrl = buildDataUrl(imageData, photo.mime_type);

    await pool.query(
      `UPDATE device_categories
       SET photo_url = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [photoUrl, categoryId]
    );

    return res.status(201).json({
      id: photo.id,
      category_id: photo.category_id,
      title: photo.title,
      created_at: photo.created_at,
      mime_type: photo.mime_type,
      image_url: photoUrl
    });
  } catch (error) {
    console.error('Failed to upload category photo', error);
    return res.status(500).json({ message: 'Failed to upload category photo' });
  }
});

router.put('/:categoryId/photo', authenticate, async (req: AuthenticatedRequest, res) => {
  const categoryId = Number(req.params.categoryId);
  const { photoId } = req.body as { photoId?: unknown };

  try {
    const categoryResult = await pool.query('SELECT owner_id FROM device_categories WHERE id = $1', [categoryId]);
    const category = categoryResult.rows[0];
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    if (req.user!.role !== 'ADMIN' && category.owner_id !== req.user!.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    let photoUrl: string | null = null;

    if (photoId !== undefined && photoId !== null && photoId !== '') {
      const parsedId = Number(photoId);
      if (Number.isNaN(parsedId)) {
        return res.status(400).json({ message: 'Invalid photoId' });
      }
      const photoResult = await pool.query<{ image_data: string; mime_type: string | null }>(
        `SELECT image_data, mime_type
         FROM category_photos
         WHERE id = $1 AND category_id = $2`,
        [parsedId, categoryId]
      );
      const photo = photoResult.rows[0];
      if (!photo) {
        return res.status(404).json({ message: 'Photo not found' });
      }
      photoUrl = buildDataUrl(photo.image_data, photo.mime_type);
    }

    await pool.query(
      `UPDATE device_categories
       SET photo_url = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [photoUrl, categoryId]
    );

    return res.json({ categoryId, photoUrl });
  } catch (error) {
    console.error('Failed to set category photo', error);
    return res.status(500).json({ message: 'Failed to set category photo' });
  }
});

export default router;
