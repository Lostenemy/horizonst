import { Router } from 'express';
import { pool } from '../db/pool';
import { verifyPasswordAsync } from '../utils/crypto';
import { signToken, credentialVersion } from '../utils/jwt';
import { createAuthRateLimit } from '../middleware/authRateLimit';

const router = Router();
const loginRateLimit = createAuthRateLimit(pool);

router.post('/register', (_req, res) => {
  return res.status(403).json({
    message: 'Public registration is disabled. Contact an authorized administrator.'
  });
});

router.post('/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || email.length > 320 || !email || typeof password !== 'string' || !password || password.length > 1024) {
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

    const valid = await verifyPasswordAsync(password, user.password_hash, user.password_salt);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = signToken({ userId: user.id, role: user.role, credentialVersion: credentialVersion(user.password_hash) });

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
