import { money } from '../../lib/money';
import { AdminShell, AsyncState } from './AdminShell';
import { useAdminLoad } from './useAdminLoad';
import type { DashboardResponse } from './types';

const metricLabels: Array<[keyof DashboardResponse['metrics'], string, 'money' | 'count']> = [
  ['customers_registered', 'Clientes registrados', 'count'],
  ['distributors_pending', 'Distribuidores pendientes', 'count'],
  ['distributors_approved', 'Distribuidores aprobados', 'count'],
  ['quotes_submitted', 'Presupuestos submitted', 'count'],
  ['quotes_in_review', 'Presupuestos in_review', 'count'],
  ['quotes_sent', 'Presupuestos sent', 'count'],
  ['quotes_accepted', 'Presupuestos accepted', 'count'],
  ['open_value_cents', 'Valor potencial abierto', 'money'],
  ['accepted_value_cents', 'Valor aceptado', 'money']
];

export default function AdminDashboard() {
  const { data, error, loading } = useAdminLoad<DashboardResponse>('/api/admin/dashboard');

  return (
    <AdminShell title="Dashboard operativo">
      <AsyncState loading={loading} error={error} />
      {data && <>
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
            <b>{event.action}</b>
            <span>{event.entity_type} · {event.actor_email ?? 'sistema'} · {new Date(event.created_at).toLocaleString()}</span>
          </article>
        ))}

        <h2>Últimos presupuestos</h2>
        {data.latestQuotes.length === 0 ? <div className="empty">Sin presupuestos.</div> : data.latestQuotes.map((quote) => (
          <article className="summary" key={quote.id}>
            <b>{quote.quote_number}</b>
            <span>{quote.email} · {quote.status} · {money(quote.total_cents)}</span>
          </article>
        ))}

        <h2>Últimos distribuidores</h2>
        {data.latestDistributors.length === 0 ? <div className="empty">Sin distribuidores.</div> : data.latestDistributors.map((distributor) => (
          <article className="summary" key={distributor.id}>
            <b>{distributor.company_name}</b>
            <span>{distributor.email} · {distributor.validation_status}</span>
          </article>
        ))}
      </>}
    </AdminShell>
  );
}
