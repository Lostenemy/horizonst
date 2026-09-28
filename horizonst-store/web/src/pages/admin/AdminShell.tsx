import { ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const links = [
  ['/admin', 'Resumen comercial'],
  ['/admin/distributors', 'Distribuidores'],
  ['/admin/distributor-resources', 'Documentación distribuidores'],
  ['/admin/customers', 'Clientes'],
  ['/admin/prereservations', 'Prerreservas'],
  ['/admin/quotes', 'Gestionar presupuestos'],
  ['/admin/orders', 'Pedidos'],
  ['/admin/audit', 'Auditoría'],
  ['/admin/catalog/products', 'Productos'],
  ['/admin/catalog/saas-plans', 'Planes web']
] as const;

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const section = [...links].reverse().find(([to]) => pathname === to || pathname.startsWith(`${to}/`))?.[1] ?? title;
  return (
    <section className="panel">
      <h1>{title}</h1>
      <button className="nav-toggle" type="button" aria-expanded={menuOpen} aria-controls="admin-navigation" onClick={() => setMenuOpen(!menuOpen)}>Secciones · {section}</button>
      <nav id="admin-navigation" aria-label="Administración" className={`admin-nav ${menuOpen ? '' : 'mobile-hidden'}`}>
        {links.map(([to, label]) => <NavLink end={to === '/admin'} key={to} to={to} onClick={() => setMenuOpen(false)}>{label}</NavLink>)}
      </nav>
      {children}
    </section>
  );
}

export function AsyncState({ loading, error, empty }: { loading: boolean; error?: string; empty?: boolean }) {
  if (loading) return <p className="muted">Cargando…</p>;
  if (error) return <p className="error">{error}</p>;
  if (empty) return <div className="empty">No hay resultados.</div>;
  return null;
}
