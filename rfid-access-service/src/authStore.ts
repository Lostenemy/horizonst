import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

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

const storePath = process.env.RFID_WEB_USER_STORE || path.join(process.cwd(), 'data', 'app-users.json');

const ensureStoreFolder = async (): Promise<void> => {
  await mkdir(path.dirname(storePath), { recursive: true });
};

const readStore = async (): Promise<AppUserRecord[]> => {
  try {
    const raw = await readFile(storePath, 'utf8');
    const data = JSON.parse(raw) as AppUserRecord[];
    if (!Array.isArray(data)) {
      throw new Error('Store is not an array');
    }
    return data;
  } catch (error) {
    return [];
  }
};

const writeStore = async (users: AppUserRecord[]): Promise<void> => {
  await ensureStoreFolder();
  await writeFile(storePath, JSON.stringify(users, null, 2), 'utf8');
};

const sanitize = (user: AppUserRecord): PublicAppUser => {
  const { password, ...rest } = user;
  return rest;
};

export const ensureDefaultAdmin = async (defaults: DefaultUserOptions): Promise<PublicAppUser> => {
  const users = await readStore();
  const existing = users.find((user) => user.username === defaults.username);

  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      existing.updatedAt = new Date().toISOString();
      await writeStore(users);
    }
    return sanitize(existing);
  }

  const now = new Date().toISOString();
  const admin: AppUserRecord = {
    username: defaults.username,
    password: defaults.password,
    role: defaults.role ?? 'admin',
    active: true,
    createdAt: now,
    updatedAt: now
  };

  users.push(admin);
  await writeStore(users);
  return sanitize(admin);
};

export const listUsers = async (): Promise<PublicAppUser[]> => {
  const users = await readStore();
  return users.map(sanitize);
};

export const authenticateUser = async (
  username: string,
  password: string
): Promise<PublicAppUser | null> => {
  const users = await readStore();
  const found = users.find((user) => user.username === username && user.password === password);
  if (!found || !found.active) {
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
  const users = await readStore();

  if (users.some((user) => user.username === username)) {
    throw new Error('USERNAME_EXISTS');
  }

  const now = new Date().toISOString();
  const record: AppUserRecord = { username, password, role, active, createdAt: now, updatedAt: now };
  users.push(record);
  await writeStore(users);
  return sanitize(record);
};

export const updateUser = async (
  username: string,
  changes: Partial<Pick<AppUserRecord, 'password' | 'role' | 'active'>>
): Promise<PublicAppUser> => {
  const users = await readStore();
  const index = users.findIndex((user) => user.username === username);

  if (index === -1) {
    throw new Error('NOT_FOUND');
  }

  const next = { ...users[index], ...changes, updatedAt: new Date().toISOString() } satisfies AppUserRecord;

  if (next.role !== 'admin') {
    const remainingAdmins = users.filter((user, idx) => idx !== index && user.role === 'admin' && user.active);
    if (remainingAdmins.length === 0) {
      throw new Error('LAST_ADMIN');
    }
  }

  users[index] = next;
  await writeStore(users);
  return sanitize(next);
};

export const deleteUser = async (username: string): Promise<void> => {
  const users = await readStore();
  const target = users.find((user) => user.username === username);
  if (!target) {
    throw new Error('NOT_FOUND');
  }

  if (target.role === 'admin') {
    const remainingAdmins = users.filter((user) => user.username !== username && user.role === 'admin' && user.active);
    if (remainingAdmins.length === 0) {
      throw new Error('LAST_ADMIN');
    }
  }

  const filtered = users.filter((user) => user.username !== username);
  await writeStore(filtered);
};

