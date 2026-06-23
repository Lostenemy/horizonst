import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { auth } from '../lib/auth';
import { useAuth } from './AuthProvider';

export default function Layout() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const handleLogout = async () => {
    try {
      if (auth.refreshToken) {
        await api('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
          skipRefresh: true
        });
      }
    } finally {
      logout();
      navigate('/');
    }
  };

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">HorizonST Store</Link>
        <nav>
          <NavLink to="/catalog">Catálogo</NavLink>
          <NavLink to="/saas-plans">Planes SaaS</NavLink>
          {user ? (
            <>
              <NavLink to="/dashboard">Dashboard</NavLink>
              <NavLink to="/cart">Carrito</NavLink>
              {user.role === 'distributor' && <NavLink to="/distributor">Distribuidor</NavLink>}
              {user.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
              <button type="button" onClick={handleLogout}>Salir</button>
            </>
          ) : (
            <>
              <NavLink to="/login">Login</NavLink>
              <NavLink to="/register">Registro</NavLink>
            </>
          )}
        </nav>
      </header>
      <main className="container"><Outlet /></main>
      <footer>HorizonST · Soluciones B2B de trazabilidad, frío y RFID</footer>
    </>
  );
}
