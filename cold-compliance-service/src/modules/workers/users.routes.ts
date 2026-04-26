import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';

export const usersRouter = Router();

usersRouter.use(requireAuth);

function toTrimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toOptionalTrimmedText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = toTrimmedText(value);
  return trimmed === '' ? null : trimmed;
}

function badRequest(message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
}

function assertRoleAllowedForManagement(role: unknown): void {
  if (role === 'superadministrador') {
    throw badRequest('role_not_allowed');
  }
}

async function getUserById(id: string) {
  const result = await db.query('SELECT id, role FROM app_users WHERE id = $1', [id]);
  return result.rows[0] as { id: string; role: string } | undefined;
}

usersRouter.get('/', requireRoles(['administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const baseQuery =
      `SELECT id, first_name, last_name, email, phone, dni, role, status, shift, created_at, updated_at
       FROM app_users`;
    const whereClause = req.authUser?.role === 'administrador' ? ` WHERE role <> 'superadministrador'` : '';
    const result = await db.query(
      `${baseQuery}${whereClause} ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

usersRouter.post('/', requireRoles(['administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const { nombre, apellidos, email, telefono, dni, rol, estado, password, turno } = req.body;
    const normalizedNombre = toTrimmedText(nombre);
    const normalizedApellidos = toTrimmedText(apellidos);
    const normalizedEmail = toTrimmedText(email);
    const normalizedDni = toTrimmedText(dni);
    const normalizedRol = toTrimmedText(rol);
    const normalizedPassword = toTrimmedText(password);
    const normalizedTelefono = toOptionalTrimmedText(telefono);
    const normalizedTurno = toOptionalTrimmedText(turno);

    if (!normalizedNombre || !normalizedApellidos || !normalizedEmail || !normalizedDni || !normalizedRol || !normalizedPassword) {
      throw badRequest('Campos obligatorios: nombre, apellidos, email, dni, rol y password');
    }

    assertRoleAllowedForManagement(normalizedRol);
    const result = await db.query(
      `INSERT INTO app_users(first_name,last_name,email,phone,dni,role,status,password_hash,shift)
       VALUES($1,$2,$3,$4,$5,$6,$7,crypt($8, gen_salt('bf')),$9)
       RETURNING id, first_name, last_name, email, phone, dni, role, status, shift, created_at, updated_at`,
      [normalizedNombre, normalizedApellidos, normalizedEmail, normalizedTelefono, normalizedDni, normalizedRol, estado ?? 'active', normalizedPassword, normalizedTurno]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

usersRouter.patch('/:id', requireRoles(['administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const targetUser = await getUserById(req.params.id);
    if (targetUser && req.authUser?.role === 'administrador' && targetUser.role === 'superadministrador') {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { nombre, apellidos, email, telefono, dni, rol, estado, password, turno } = req.body;
    const normalizedNombre = toOptionalTrimmedText(nombre);
    const normalizedApellidos = toOptionalTrimmedText(apellidos);
    const normalizedEmail = toOptionalTrimmedText(email);
    const normalizedTelefono = toOptionalTrimmedText(telefono);
    const normalizedRol = toOptionalTrimmedText(rol);
    const normalizedTurno = toOptionalTrimmedText(turno);
    const normalizedPassword = toOptionalTrimmedText(password);
    const normalizedDni = toOptionalTrimmedText(dni);

    if (dni !== undefined && normalizedDni === null) {
      throw badRequest('dni no puede estar vacío');
    }

    if (normalizedRol !== null) {
      assertRoleAllowedForManagement(normalizedRol);
    }
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
           password_hash = CASE WHEN $10::text IS NULL THEN password_hash ELSE crypt($10::text, gen_salt('bf')) END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, first_name, last_name, email, phone, dni, role, status, shift, created_at, updated_at`,
      [req.params.id, normalizedNombre, normalizedApellidos, normalizedEmail, normalizedTelefono, normalizedDni, normalizedRol, estado ?? null, normalizedTurno, normalizedPassword]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

usersRouter.post('/:id/deactivate', requireRoles(['administrador', 'superadministrador']), async (req, res, next) => {
  try {
    const targetUser = await getUserById(req.params.id);
    if (targetUser && req.authUser?.role === 'administrador' && targetUser.role === 'superadministrador') {
      return res.status(403).json({ error: 'forbidden' });
    }

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
    if (req.authUser?.id === req.params.id) {
      return res.status(403).json({ error: 'forbidden' });
    }
    await db.query('DELETE FROM app_users WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
