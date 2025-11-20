import { db, initDatabase } from './db.js';

export type AppUserRole = 'admin' | 'user';

export interface AppUserRecord {
  username: string;
  password: string;
  role: AppUserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PublicAppUser = Omit<AppUserRecord, 'password'>;

interface DefaultUserOptions {
  username: string;
  password: string;
  role?: AppUserRole;
}

const sanitize = (user: AppUserRecord): PublicAppUser => {
  const { password, ...rest } = user;
  return rest;
};

const toRecord = (row: {
  username: string;
  password: string;
  role: AppUserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}): AppUserRecord => ({
  username: row.username,
  password: row.password,
  role: row.role,
  active: row.active,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

const countActiveAdmins = async (excludeUsername?: string): Promise<number> => {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin' AND active = TRUE ${excludeUsername ? 'AND username <> $1' : ''}`,
    excludeUsername ? [excludeUsername] : []
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
};

export const ensureDefaultAdmin = async (defaults: DefaultUserOptions): Promise<PublicAppUser> => {
  await initDatabase();
  const existing = await db.query<AppUserRecord>(
    'SELECT username, password, role, active, created_at AS "createdAt", updated_at AS "updatedAt" FROM app_users WHERE username = $1 LIMIT 1',
    [defaults.username]
  );

  if (existing.rows[0]) {
    const record = existing.rows[0];
    if (record.role !== 'admin') {
      const updated = await db.query<AppUserRecord>(
        `UPDATE app_users SET role = 'admin', active = TRUE, updated_at = NOW() WHERE username = $1 RETURNING username, password, role, active, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [defaults.username]
      );
      return sanitize(updated.rows[0]);
    }
    return sanitize(existing.rows[0]);
  }

  const created = await db.query<AppUserRecord>(
    `INSERT INTO app_users (username, password, role, active)
     VALUES ($1, $2, $3, TRUE)
     RETURNING username, password, role, active, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [defaults.username, defaults.password, defaults.role ?? 'admin']
  );

  return sanitize(created.rows[0]);
};

export const listUsers = async (): Promise<PublicAppUser[]> => {
  await initDatabase();
  const { rows } = await db.query<AppUserRecord>(
    'SELECT username, password, role, active, created_at AS "createdAt", updated_at AS "updatedAt" FROM app_users ORDER BY username'
  );
  return rows.map(sanitize);
};

export const authenticateUser = async (
  username: string,
  password: string
): Promise<PublicAppUser | null> => {
  await initDatabase();
  const { rows } = await db.query<AppUserRecord>(
    'SELECT username, password, role, active, created_at AS "createdAt", updated_at AS "updatedAt" FROM app_users WHERE username = $1 LIMIT 1',
    [username]
  );
  const found = rows[0];
  if (!found || !found.active || found.password !== password) {
    return null;
  }
  return sanitize(found);
};

export const createUser = async (
  username: string,
  password: string,
  role: AppUserRole,
  active = true
): Promise<PublicAppUser> => {
  await initDatabase();
  const existing = await db.query<AppUserRecord>(
    'SELECT username FROM app_users WHERE username = $1 LIMIT 1',
    [username]
  );

  if (existing.rows[0]) {
    throw new Error('USERNAME_EXISTS');
  }

  const { rows } = await db.query<AppUserRecord>(
    `INSERT INTO app_users (username, password, role, active)
     VALUES ($1, $2, $3, $4)
     RETURNING username, password, role, active, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [username, password, role, active]
  );

  return sanitize(toRecord(rows[0]));
};

export const updateUser = async (
  username: string,
  changes: Partial<Pick<AppUserRecord, 'password' | 'role' | 'active'>>
): Promise<PublicAppUser> => {
  await initDatabase();
  const current = await db.query<AppUserRecord>(
    'SELECT username, password, role, active, created_at AS "createdAt", updated_at AS "updatedAt" FROM app_users WHERE username = $1',
    [username]
  );

  const existing = current.rows[0];
  if (!existing) {
    throw new Error('NOT_FOUND');
  }

  const nextRole = changes.role ?? existing.role;
  const nextActive = changes.active ?? existing.active;
  if ((nextRole !== 'admin' || nextActive === false) && existing.role === 'admin' && existing.active) {
    const admins = await countActiveAdmins(existing.username);
    if (admins === 0) {
      throw new Error('LAST_ADMIN');
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (changes.password !== undefined) {
    fields.push(`password = $${idx++}`);
    values.push(changes.password);
  }
  if (changes.role !== undefined) {
    fields.push(`role = $${idx++}`);
    values.push(changes.role);
  }
  if (changes.active !== undefined) {
    fields.push(`active = $${idx++}`);
    values.push(changes.active);
  }
  fields.push(`updated_at = NOW()`);
  values.push(username);

  const { rows } = await db.query<AppUserRecord>(
    `UPDATE app_users SET ${fields.join(', ')} WHERE username = $${idx} RETURNING username, password, role, active, created_at AS "createdAt", updated_at AS "updatedAt"`,
    values
  );

  return sanitize(toRecord(rows[0]));
};

export const deleteUser = async (username: string): Promise<void> => {
  await initDatabase();
  const existing = await db.query<AppUserRecord>(
    'SELECT username, role, active FROM app_users WHERE username = $1',
    [username]
  );
  const target = existing.rows[0];
  if (!target) {
    throw new Error('NOT_FOUND');
  }

  if (target.role === 'admin' && target.active) {
    const admins = await countActiveAdmins(username);
    if (admins === 0) {
      throw new Error('LAST_ADMIN');
    }
  }

  await db.query('DELETE FROM app_users WHERE username = $1', [username]);
};

