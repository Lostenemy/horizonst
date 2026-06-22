import { Navigate, Outlet } from 'react-router-dom';
import { Role, auth } from '../lib/auth';
export default function RoleRoute({ roles }: { roles: Role[] }) { const role = auth.user?.role; return role && roles.includes(role) ? <Outlet /> : <Navigate to="/dashboard" replace />; }
