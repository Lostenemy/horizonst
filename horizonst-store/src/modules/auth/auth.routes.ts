import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(10).max(200),
  fullName: z.string().min(2).max(200),
  phone: z.string().max(50).optional()
});

authRouter.post('/register', async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const { rows } = await pool.query(
      `INSERT INTO store.users (email, password_hash, full_name, phone, role, status)
       VALUES ($1, $2, $3, $4, 'customer', 'pending_email_verification')
       RETURNING id, email, full_name, phone, role, status, created_at`,
      [input.email.toLowerCase(), passwordHash, input.fullName, input.phone ?? null]
    );
    res.status(201).json({ user: rows[0] });
  } catch (error) {
    next(error);
  }
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post('/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, full_name, phone, role, status, created_at
       FROM store.users
       WHERE email = $1 AND status <> 'closed'`,
      [input.email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    await pool.query('UPDATE store.users SET last_login_at = now(), updated_at = now() WHERE id = $1', [user.id]);
    const { password_hash: _passwordHash, ...safeUser } = user;
    res.json({ user: safeUser, message: 'Login preparado sin emisión de sesión/JWT en incremento 1' });
  } catch (error) {
    next(error);
  }
});
