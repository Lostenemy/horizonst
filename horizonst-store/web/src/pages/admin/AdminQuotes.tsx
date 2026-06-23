import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { money } from '../../lib/money';
import { AdminShell, AsyncState } from './AdminShell';
import { submitParams } from './adminUtils';
import { useAdminLoad } from './useAdminLoad';
import type { QuotesResponse } from './types';

const quoteStatuses = ['draft', 'submitted', 'in_review', 'sent', 'accepted', 'rejected', 'cancelled'];
const fields = ['status', 'email', 'quote_number'];

export default function AdminQuotes() {
  const [query, setQuery] = useState('');
  const { data, error, loading } = useAdminLoad<QuotesResponse>(`/api/admin/quotes${query}`);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(submitParams(event.currentTarget, fields));
  };

  return (
    <AdminShell title="Presupuestos">
      <form className="filters" onSubmit={onSubmit}>
        <select name="status"><option value="">Estado</option>{quoteStatuses.map((status) => <option key={status}>{status}</option>)}</select>
        <input name="email" placeholder="Email" />
        <input name="quote_number" placeholder="Número" />
        <button>Filtrar</button>
      </form>
      <AsyncState loading={loading} error={error} empty={data?.quotes.length === 0} />
      {data?.quotes.map((quote) => (
        <article className="summary" key={quote.id}>
          <b>{quote.quote_number}</b>
          <span>{quote.email} · {quote.status} · {money(quote.total_cents)}</span>
          <Link to={`/admin/quotes/${quote.id}`}>Ver detalle</Link>
        </article>
      ))}
    </AdminShell>
  );
}
