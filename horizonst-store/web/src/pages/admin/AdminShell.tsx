import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const links = [
  ['/admin', 'Dashboard'],
  ['/admin/distributors', 'Distribuidores'],
  ['/admin/quotes', 'Presupuestos'],
  ['/admin/audit', 'Auditoría'],
  ['/admin/catalog/products', 'Productos'],
  ['/admin/catalog/saas-plans', 'Planes SaaS']
] as const;

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="admin-nav">
        {links.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
      </div>
      <h1>{title}</h1>
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
