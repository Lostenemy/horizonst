import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import Loading from './Loading';

export default function ProtectedRoute() {
  const location = useLocation();
  const { authenticated, loading } = useAuth();

  if (loading) return <Loading />;
  if (!authenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return <Outlet />;
}
