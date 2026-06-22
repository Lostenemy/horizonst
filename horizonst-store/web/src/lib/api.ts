import { auth } from './auth';
import type { User } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
  }
}

type ApiOptions = RequestInit & { skipRefresh?: boolean };
type RefreshResponse = { user: User; accessToken: string };

const readJson = async (res: Response) => res.json().catch(() => ({}));

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (auth.accessToken) headers.set('Authorization', `Bearer ${auth.accessToken}`);

  const res = await fetch(path, { ...options, headers });
  const data = await readJson(res);

  if (!res.ok) {
    throw new ApiError(data.error ?? 'Error de API', res.status, data.details);
  }

  return data as T;
}

async function refreshAccessToken(): Promise<boolean> {
  if (!auth.refreshToken) return false;

  try {
    const data = await request<RefreshResponse>('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
      skipRefresh: true
    });
    auth.setAccessToken(data.accessToken);
    auth.setUser(data.user);
    return true;
  } catch {
    auth.clear();
    return false;
  }
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  try {
    return await request<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && !options.skipRefresh) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return request<T>(path, { ...options, skipRefresh: true });
    }
    throw error;
  }
}

export const postJson = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const patchJson = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
