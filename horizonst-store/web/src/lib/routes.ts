import type { Role } from './types';

export function defaultRouteForRole(role?: Role) {
  if (role === 'admin') return '/admin';
  if (role === 'distributor') return '/distributor';
  return '/dashboard';
}
