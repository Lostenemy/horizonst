import { Router } from 'express';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { pool } from '../db/pool';
import { hashPassword } from '../utils/crypto';

const router = Router();

router.get('/me', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, role, display_name, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.user!.id]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to fetch profile', error);
    return res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

router.get('/', authenticate, authorize(['ADMIN']), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, role, display_name, created_at, updated_at FROM users ORDER BY id`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list users', error);
    return res.status(500).json({ message: 'Failed to list users' });
  }
});

router.post('/', authenticate, authorize(['ADMIN']), async (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ message: 'Email, password and role are required' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if ((existing.rowCount ?? 0) > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const { hash, salt } = hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, password_salt, role, display_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, role, display_name`,
      [email, hash, salt, role, name ?? null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to create user', error);
    return res.status(500).json({ message: 'Failed to create user' });
  }
});

router.get('/groups', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.name, g.description, g.owner_id, g.created_at, g.updated_at,
              EXISTS(SELECT 1 FROM user_group_members m WHERE m.group_id = g.id AND m.user_id = $1) AS is_member
       FROM user_groups g
       WHERE g.owner_id = $1
          OR EXISTS(SELECT 1 FROM user_group_members m WHERE m.group_id = g.id AND m.user_id = $1)
       ORDER BY g.name`,
      [req.user!.id]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list user groups', error);
    return res.status(500).json({ message: 'Failed to list user groups' });
  }
});

router.post('/groups', authenticate, async (req: AuthenticatedRequest, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Group name is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO user_groups (owner_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, owner_id, name, description, created_at, updated_at`,
      [req.user!.id, name, description ?? null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to create user group', error);
    return res.status(500).json({ message: 'Failed to create user group' });
  }
});

router.post('/groups/:groupId/members', authenticate, async (req: AuthenticatedRequest, res) => {
  const { userId, isManager } = req.body;
  const groupId = Number(req.params.groupId);
  if (!userId) {
    return res.status(400).json({ message: 'userId is required' });
  }

  try {
    const groupResult = await pool.query(
      `SELECT owner_id FROM user_groups WHERE id = $1`,
      [groupId]
    );
    const group = groupResult.rows[0];
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (group.owner_id !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const result = await pool.query(
      `INSERT INTO user_group_members (group_id, user_id, is_manager)
       VALUES ($1, $2, $3)
       ON CONFLICT (group_id, user_id) DO UPDATE SET is_manager = EXCLUDED.is_manager
       RETURNING group_id, user_id, is_manager`,
      [groupId, userId, isManager ?? false]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to update group member', error);
    return res.status(500).json({ message: 'Failed to update group member' });
  }
});

router.delete('/groups/:groupId/members/:userId', authenticate, async (req: AuthenticatedRequest, res) => {
  const groupId = Number(req.params.groupId);
  const userId = Number(req.params.userId);

  try {
    const groupResult = await pool.query('SELECT owner_id FROM user_groups WHERE id = $1', [groupId]);
    const group = groupResult.rows[0];
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (group.owner_id !== req.user!.id && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await pool.query('DELETE FROM user_group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
    return res.status(204).send();
  } catch (error) {
    console.error('Failed to remove group member', error);
    return res.status(500).json({ message: 'Failed to remove group member' });
  }
});

export default router;
