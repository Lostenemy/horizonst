import { money } from '../../lib/money';
import { AdminShell, AsyncState } from './AdminShell';
import { useAdminLoad } from './useAdminLoad';
import type { DashboardResponse } from './types';
import { Link } from 'react-router-dom';
import { displayLabel, quoteDisplayName, quoteStatusLabels } from '../../lib/presentation';

const metricLabels: Array<[keyof DashboardResponse['metrics'], string, 'money' | 'count']> = [
  ['customers_registered', 'Clientes registrados', 'count'],
  ['distributors_pending', 'Distribuidores pendientes', 'count'],
  ['distributors_approved', 'Distribuidores aprobados', 'count'],
  ['quotes_submitted', quoteStatusLabels.submitted, 'count'],
  ['quotes_in_review', quoteStatusLabels.in_review, 'count'],
  ['quotes_sent', quoteStatusLabels.sent, 'count'],
  ['quotes_accepted', 'Presupuestos aceptados', 'count'],
  ['open_value_cents', 'Valor potencial abierto', 'money'],
  ['accepted_value_cents', 'Valor aceptado', 'money']
];

export default function AdminDashboard() {
  const { data, error, loading } = useAdminLoad<DashboardResponse>('/api/admin/dashboard');

  return (
    <AdminShell title="Resumen comercial">
      <AsyncState loading={loading} error={error} />
      {data && <>
        <p className="muted">Alcance: todo el histórico registrado, sin filtro de fechas. Valor abierto: suma de solicitudes recibidas, en revisión y propuestas enviadas. Valor aceptado: presupuestos aceptados. Ambos importes incluyen IVA y descuentos; no equivalen a ingresos cobrados.</p>
        <div className="actions"><Link className="btn" to="/admin/quotes?status=submitted">Revisar solicitudes recibidas</Link><Link className="btn" to="/admin/distributors">Revisar distribuidores</Link></div>
        <div className="cards compact">
          {metricLabels.map(([key, label, type]) => (
            <article className="card" key={key}>
              <small>{label}</small>
              <h2>{type === 'money' ? money(data.metrics[key]) : data.metrics[key]}</h2>
            </article>
          ))}
        </div>

        <h2>Últimos eventos</h2>
        {data.latestAudit.length === 0 ? <div className="empty">Sin eventos.</div> : data.latestAudit.map((event) => (
          <article className="summary" key={event.id}>
            <b>{displayLabel(event.action)}</b>
            <span>{displayLabel(event.entity_type)} · {event.actor_email ?? 'sistema'} · {new Date(event.created_at).toLocaleString()}</span>
          </article>
        ))}

        <h2>Últimos presupuestos</h2>
        {data.latestQuotes.length === 0 ? <div className="empty">Sin presupuestos.</div> : data.latestQuotes.map((quote) => (
          <article className="summary" key={quote.id}>
            <b>{quoteDisplayName(quote)}</b>
            <span>{quote.email} · {displayLabel(quote.status)} · {money(quote.total_cents)}</span>
            <Link to={`/admin/quotes/${quote.id}`}>Ver presupuesto</Link>
          </article>
        ))}

        <h2>Últimos distribuidores</h2>
        {data.latestDistributors.length === 0 ? <div className="empty">Sin distribuidores.</div> : data.latestDistributors.map((distributor) => (
          <article className="summary" key={distributor.id}>
            <b>{distributor.company_name}</b>
            <span>{distributor.email} · {displayLabel(distributor.validation_status)}</span>
          </article>
        ))}
      </>}
    </AdminShell>
  );
}
