import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { auth } from '../lib/auth';
export default function ProtectedRoute() { const location = useLocation(); return auth.isAuthenticated() ? <Outlet /> : <Navigate to="/login" replace state={{ from: location.pathname }} />; }
