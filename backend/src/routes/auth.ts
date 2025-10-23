import { Router } from 'express';
import { pool } from '../db/pool';
import { hashPassword, verifyPassword } from '../utils/crypto';
import { signToken } from '../utils/jwt';
import { Role } from '../types';

const router = Router();

router.post('/register', async (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const userRole: Role = role === 'ADMIN' ? 'ADMIN' : 'USER';

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
      [email, hash, salt, userRole, name ?? null]
    );

    const user = result.rows[0];
    const token = signToken({ userId: user.id, role: user.role });

    return res.status(201).json({
      token,
      user
    });
  } catch (error) {
    console.error('Failed to register user', error);
    return res.status(500).json({ message: 'Failed to register user' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, role, password_hash, password_salt, display_name
       FROM users
       WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const valid = verifyPassword(password, user.password_hash, user.password_salt);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = signToken({ userId: user.id, role: user.role });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        display_name: user.display_name
      }
    });
  } catch (error) {
    console.error('Failed to login', error);
    return res.status(500).json({ message: 'Failed to login' });
  }
});

export default router;
