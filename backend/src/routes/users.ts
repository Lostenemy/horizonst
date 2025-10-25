import { Router } from 'express';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { pool } from '../db/pool';
import { hashPassword } from '../utils/crypto';
import { Role } from '../types';

const router = Router();

const normalizeRole = (value: unknown): Role | null => {
  return value === 'ADMIN' || value === 'USER' ? value : null;
};

const getAdminCount = async (): Promise<number> => {
  const result = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM users WHERE role = $1',
    ['ADMIN']
  );
  return result.rows[0]?.count ?? 0;
};

interface PgError extends Error {
  code?: string;
}

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
  const normalizedEmail = typeof email === 'string' ? email.trim() : '';
  const normalizedRole = normalizeRole(role);
  const passwordValue = typeof password === 'string' ? password : '';
  const displayName = typeof name === 'string' ? name.trim() : '';

  if (!normalizedEmail || !passwordValue || !normalizedRole) {
    return res.status(400).json({ message: 'Email, contraseña y rol son obligatorios' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if ((existing.rowCount ?? 0) > 0) {
      return res.status(409).json({ message: 'Email ya registrado' });
    }

    const { hash, salt } = hashPassword(passwordValue);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, password_salt, role, display_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, role, display_name, created_at, updated_at`,
      [normalizedEmail, hash, salt, normalizedRole, displayName ? displayName : null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    const pgError = error as PgError;
    if (pgError.code === '23505') {
      return res.status(409).json({ message: 'Email ya en uso' });
    }
    console.error('Failed to create user', error);
    return res.status(500).json({ message: 'Failed to create user' });
  }
});

router.put('/:id', authenticate, authorize(['ADMIN']), async (req: AuthenticatedRequest, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Identificador no válido' });
  }

  const { email, name, role, password } = req.body ?? {};

  try {
    const existingResult = await pool.query<{ id: number; role: Role }>(
      'SELECT id, role FROM users WHERE id = $1',
      [userId]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const normalizedEmail =
      email === undefined ? undefined : typeof email === 'string' ? email.trim() : '';
    if (normalizedEmail !== undefined && !normalizedEmail) {
      return res.status(400).json({ message: 'El email no puede estar vacío' });
    }

    const displayName = name === undefined ? undefined : typeof name === 'string' ? name.trim() : '';

    const normalizedRole = role === undefined ? undefined : normalizeRole(role);
    if (role !== undefined && !normalizedRole) {
      return res.status(400).json({ message: 'Rol no válido' });
    }

    if (normalizedRole === 'USER' && existing.role === 'ADMIN') {
      const adminCount = await getAdminCount();
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Debe existir al menos un administrador' });
      }
    }

    const passwordValue =
      password === undefined ? undefined : typeof password === 'string' ? password : '';
    if (passwordValue !== undefined && !passwordValue) {
      return res.status(400).json({ message: 'La contraseña no puede estar vacía' });
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (normalizedEmail !== undefined) {
      updates.push(`email = $${updates.length + 1}`);
      values.push(normalizedEmail);
    }

    if (displayName !== undefined) {
      updates.push(`display_name = $${updates.length + 1}`);
      values.push(displayName || null);
    }

    if (normalizedRole !== undefined) {
      updates.push(`role = $${updates.length + 1}`);
      values.push(normalizedRole);
    }

    if (passwordValue !== undefined) {
      const { hash, salt } = hashPassword(passwordValue);
      updates.push(`password_hash = $${updates.length + 1}`);
      values.push(hash);
      updates.push(`password_salt = $${updates.length + 1}`);
      values.push(salt);
    }

    if (!updates.length) {
      return res.status(400).json({ message: 'No hay cambios para aplicar' });
    }

    updates.push('updated_at = NOW()');

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length + 1}
       RETURNING id, email, role, display_name, created_at, updated_at`,
      [...values, userId]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    const pgError = error as PgError;
    if (pgError.code === '23505') {
      return res.status(409).json({ message: 'Email ya en uso' });
    }
    console.error('Failed to update user', error);
    return res.status(500).json({ message: 'Failed to update user' });
  }
});

router.delete('/:id', authenticate, authorize(['ADMIN']), async (req: AuthenticatedRequest, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: 'Identificador no válido' });
  }

  if (req.user?.id === userId) {
    return res.status(400).json({ message: 'No puedes eliminar tu propio usuario' });
  }

  try {
    const existingResult = await pool.query<{ id: number; role: Role }>(
      'SELECT id, role FROM users WHERE id = $1',
      [userId]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    if (existing.role === 'ADMIN') {
      const adminCount = await getAdminCount();
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Debe existir al menos un administrador' });
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    return res.status(204).send();
  } catch (error) {
    console.error('Failed to delete user', error);
    return res.status(500).json({ message: 'Failed to delete user' });
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
