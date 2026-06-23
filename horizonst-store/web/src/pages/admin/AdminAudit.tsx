import { FormEvent, useState } from 'react';
import { AdminShell, AsyncState } from './AdminShell';
import { payloadSummary, submitParams } from './adminUtils';
import { useAdminLoad } from './useAdminLoad';
import type { AuditResponse } from './types';

const fields = ['action', 'entity_type', 'actor_user_id', 'entity_id', 'date_from', 'date_to', 'search', 'limit'];

export default function AdminAudit() {
  const [query, setQuery] = useState('');
  const { data, error, loading } = useAdminLoad<AuditResponse>(`/api/admin/audit${query}`);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(submitParams(event.currentTarget, fields));
  };

  return (
    <AdminShell title="Auditoría">
      <form className="filters" onSubmit={onSubmit}>
        {fields.map((field) => <input key={field} name={field} placeholder={field} />)}
        <button>Filtrar</button>
      </form>
      <AsyncState loading={loading} error={error} empty={data?.events.length === 0} />
      {data?.events.map((event) => (
        <article className="summary" key={event.id}>
          <b>{event.action}</b>
          <span>{event.entity_type} · {event.entity_id ?? '—'} · {new Date(event.created_at).toLocaleString()}</span>
          <span>{event.actor_email ?? event.actor_user_id ?? 'sistema'}</span>
          <pre>{payloadSummary(event.payload)}</pre>
        </article>
      ))}
    </AdminShell>
  );
}
