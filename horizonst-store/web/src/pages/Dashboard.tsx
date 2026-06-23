import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <section className="panel">
      <h1>Dashboard</h1>
      {user && (
        <>
          <p><b>{user.full_name}</b> · {user.email} · {user.role}</p>
          <div className="actions">
            <Link className="btn" to="/account">Cuenta</Link>
            <Link className="btn" to="/cart">Carrito</Link>
            <Link className="btn" to="/quotes">Presupuestos</Link>
            {user.role === 'distributor' && <Link className="btn" to="/distributor/profile">Perfil distribuidor</Link>}
            {user.role === 'admin' && <Link className="btn" to="/admin">Admin</Link>}
          </div>
        </>
      )}
    </section>
  );
}
