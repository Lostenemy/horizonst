import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { money } from '../../lib/money';
import { AdminShell, AsyncState } from './AdminShell';
import { submitParams } from './adminUtils';
import { useAdminLoad } from './useAdminLoad';
import type { QuotesResponse } from './types';
import { displayLabel, quoteDisplayName } from '../../lib/presentation';

const quoteStatuses = ['draft', 'submitted', 'in_review', 'sent', 'accepted', 'rejected', 'cancelled'];
const fields = ['status', 'email', 'quote_number'];

export default function AdminQuotes() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState(search);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { setQuery(search); formRef.current?.reset(); }, [search]);
  const { data, error, loading } = useAdminLoad<QuotesResponse>(`/api/admin/quotes${query}`);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(submitParams(event.currentTarget, fields));
  };

  return (
    <AdminShell title="Gestionar presupuestos">
      <form key={search} ref={formRef} className="filters" onSubmit={onSubmit}>
        <label htmlFor="quote-status">Estado<select id="quote-status" name="status" defaultValue={new URLSearchParams(search).get('status') ?? ''}><option value="">Todos</option>{quoteStatuses.map((status) => <option key={status} value={status}>{displayLabel(status)}</option>)}</select></label>
        <label htmlFor="quote-email">Email<input id="quote-email" name="email" type="search" /></label>
        <label htmlFor="quote-number">Número<input id="quote-number" name="quote_number" type="search" /></label>
        <button>Filtrar</button>
        <button type="button" onClick={() => { formRef.current?.reset(); setQuery(''); navigate('/admin/quotes', { replace: true }); }}>Limpiar filtros</button>
      </form>
      {query && <p className="muted">Filtros aplicados: {Array.from(new URLSearchParams(query), ([key, value]) => `${key === 'status' ? 'Estado' : key === 'email' ? 'Email' : 'Número'}: ${key === 'status' ? displayLabel(value) : value}`).join(' · ')}</p>}
      <AsyncState loading={loading} error={error} />
      {!loading && !error && data?.quotes.length === 0 && <p className="empty">{query ? 'No hay presupuestos que coincidan con estos filtros. Puedes limpiar los filtros para recuperar la lista.' : 'Todavía no hay presupuestos.'}</p>}
      {data?.quotes.map((quote) => (
        <article className="summary" key={quote.id}>
          <b>{quoteDisplayName(quote)}</b>
          <span>{quote.email} · {displayLabel(quote.status)} · {money(quote.total_cents)} IVA incluido</span>
          <Link to={`/admin/quotes/${quote.id}`}>Ver detalle</Link>
        </article>
      ))}
    </AdminShell>
  );
}
