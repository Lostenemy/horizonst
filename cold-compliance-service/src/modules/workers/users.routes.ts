import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get('/', requireRoles(['administrador', 'superadministrador']), async (_req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, first_name, last_name, email, phone, dni, role, status, shift, created_at, updated_at
       FROM app_users ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

usersRouter.post('/', requireRoles(['administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const { nombre, apellidos, email, telefono, dni, rol, estado, password, turno } = req.body;
    const result = await db.query(
      `INSERT INTO app_users(first_name,last_name,email,phone,dni,role,status,password_hash,shift)
       VALUES($1,$2,$3,$4,$5,$6,$7,crypt($8, gen_salt('bf')),$9)
       RETURNING id, first_name, last_name, email, phone, dni, role, status, shift, created_at, updated_at`,
      [nombre, apellidos, email, telefono ?? null, dni, rol, estado ?? 'active', password, turno ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

usersRouter.patch('/:id', requireRoles(['administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const { nombre, apellidos, email, telefono, dni, rol, estado, password, turno } = req.body;
    const result = await db.query(
      `UPDATE app_users
       SET first_name = COALESCE($2, first_name),
           last_name = COALESCE($3, last_name),
           email = COALESCE($4, email),
           phone = COALESCE($5, phone),
           dni = COALESCE($6, dni),
           role = COALESCE($7, role),
           status = COALESCE($8, status),
           shift = COALESCE($9, shift),
           password_hash = CASE WHEN $10 IS NULL THEN password_hash ELSE crypt($10, gen_salt('bf')) END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, first_name, last_name, email, phone, dni, role, status, shift, created_at, updated_at`,
      [req.params.id, nombre ?? null, apellidos ?? null, email ?? null, telefono ?? null, dni ?? null, rol ?? null, estado ?? null, turno ?? null, password ?? null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

usersRouter.post('/:id/deactivate', requireRoles(['administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE app_users SET status = 'inactive', updated_at = NOW() WHERE id = $1
       RETURNING id, first_name, last_name, email, phone, dni, role, status, shift, created_at, updated_at`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

usersRouter.delete('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    await db.query('DELETE FROM app_users WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
