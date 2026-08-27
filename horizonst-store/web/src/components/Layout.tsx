import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { auth } from '../lib/auth';
import { useAuth } from './AuthProvider';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();

  const handleLogout = async () => {
    try {
      if (auth.refreshToken) {
        await api<{ ok: boolean }>('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: auth.refreshToken }),
          skipRefresh: true
        });
      }
    } finally {
      logout();
      navigate('/login', { replace: true });
    }
  };

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">HorizonST Store</Link>
        <nav aria-label="Navegación principal">
          <a href="https://horizonst.es">Web HorizonST</a>
          {user ? (
            <>
              <NavLink to="/catalog">Catálogo</NavLink>
              {user.role !== 'distributor' && <NavLink to="/dashboard">Dashboard</NavLink>}
              <NavLink to="/cart">Carrito</NavLink>
              <NavLink to="/quotes">Presupuestos</NavLink>
              {(user.role === 'customer' || user.role === 'distributor') && <NavLink to="/orders">Pedidos</NavLink>}
              {user.role === 'distributor' && <><NavLink to="/distributor/resources">Documentación HorizonST</NavLink><NavLink to="/distributor/documents">Mis documentos</NavLink><NavLink to="/distributor/profile">Perfil</NavLink></>}
              {user.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
              <button type="button" className="link-button" onClick={handleLogout}>Salir</button>
            </>
          ) : (
            <>
              <NavLink to="/login">Login</NavLink>
              <NavLink to="/register">Registro cliente</NavLink>
              <NavLink to="/register-distributor">Distribuidor</NavLink>
            </>
          )}
        </nav>
      </header>
      <main className={`container${location.pathname === '/register-distributor' ? ' distributor-registration-container' : ''}`}><Outlet /></main>
      <footer>HorizonST · Soluciones B2B de trazabilidad, frío y RFID</footer>
    </>
  );
}
