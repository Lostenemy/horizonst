import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <section className="panel">
      <h1>Dashboard cliente</h1>
      {user && (
        <>
          <div className="summary"><p><b>{user.full_name}</b></p><p>{user.email}</p><p>Rol: <b>{user.role}</b> · Estado: <b>{user.status}</b></p></div>
          <div className="actions">
            <Link className="btn" to="/account">Cuenta</Link>
            <Link className="btn" to="/catalog">Catálogo</Link>
            <Link className="btn" to="/saas-plans">SaaS</Link>
            <Link className="btn" to="/cart">Carrito</Link>
            <Link className="btn" to="/quotes">Presupuestos</Link>
            {(user.role === 'customer' || user.role === 'distributor') && <Link className="btn" to="/orders">Pedidos</Link>}
            {user.role === 'distributor' && <Link className="btn secondary" to="/distributor/profile">Perfil distribuidor</Link>}
            {user.role === 'admin' && <Link className="btn secondary" to="/admin">Admin</Link>}
          </div>
          <p className="muted">Consulta presupuestos y pedidos propios desde sus secciones.</p>
        </>
      )}
    </section>
  );
}
