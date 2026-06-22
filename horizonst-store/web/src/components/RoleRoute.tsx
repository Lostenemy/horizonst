import { Navigate, Outlet } from 'react-router-dom';
import type { Role } from '../lib/types';
import { useAuth } from './AuthProvider';
import Loading from './Loading';

export default function RoleRoute({ roles }: { roles: Role[] }) {
  const { loading, user } = useAuth();

  if (loading) return <Loading />;
  if (!user || !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
