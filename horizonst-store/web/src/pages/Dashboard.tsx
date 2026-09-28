import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Quote } from '../lib/types';
import { useAuth } from '../components/AuthProvider';
import { displayLabel, quoteDisplayName, quotesNavigation } from '../lib/presentation';

export default function Dashboard() {
  const { user } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [activityError, setActivityError] = useState(false);
  useEffect(() => {
    let active = true;
    setQuotes([]); setActivityError(false);
    if (user && user.role !== 'admin') api<{ quotes: Quote[] }>('/api/quotes')
      .then((data) => { if (active) setQuotes(data.quotes); })
      .catch(() => { if (active) setActivityError(true); });
    return () => { active = false; };
  }, [user?.id, user?.role]);

  return (
    <section className="panel">
      <h1>Mi área comercial</h1>
      {user && (
        <>
          <div className="summary"><p><b>{user.full_name}</b></p><p>{user.email}</p><p>Rol: <b>{displayLabel(user.role)}</b> · Estado: <b>{displayLabel(user.status)}</b></p></div>
          <p>Elige artículos en el catálogo, prepara tu carrito y consulta el estado de tus solicitudes. Esta área comercial no es el panel operativo de cámaras.</p>
          {user.role !== 'admin' && <section aria-label="Actividad comercial propia"><h2>Mis solicitudes</h2>{activityError ? <p className="error">No se pudo cargar tu actividad. Puedes reintentarlo desde Mis presupuestos.</p> : quotes.length ? quotes.slice(0, 5).map((quote) => <p key={quote.id}>{quoteDisplayName(quote)} · {displayLabel(quote.status)}</p>) : <p>Consulta Mis presupuestos para revisar tus solicitudes; para una nueva, comienza por el catálogo.</p>}</section>}
          <div className="actions">
            <Link className="btn" to="/account">Cuenta</Link>
            <Link className="btn" to="/catalog">Catálogo</Link>
            <Link className="btn" to="/saas-plans">Planes web</Link>
            <Link className="btn" to="/cart">Carrito</Link>
            <Link className="btn" to={quotesNavigation(user.role).to}>{quotesNavigation(user.role).label}</Link>
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
