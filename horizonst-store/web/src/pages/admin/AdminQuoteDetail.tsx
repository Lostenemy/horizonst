import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { patchJson } from '../../lib/api';
import { money } from '../../lib/money';
import { AdminShell, AsyncState } from './AdminShell';
import { apiMessage } from './adminUtils';
import { useAdminLoad } from './useAdminLoad';
import type { QuoteDetailResponse } from './types';

const adminStatuses = ['in_review', 'sent', 'accepted', 'rejected', 'cancelled'] as const;

type AdminStatus = typeof adminStatuses[number];

export default function AdminQuoteDetail() {
  const { id } = useParams();
  const { data, error, loading, load } = useAdminLoad<QuoteDetailResponse>(`/api/admin/quotes/${id}`);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const changeStatus = async (status: AdminStatus) => {
    setBusy(true);
    try {
      await patchJson(`/api/admin/quotes/${id}/status`, { status, internal_notes: notes || undefined });
      setFeedback('Estado actualizado');
      load();
    } catch (statusError) {
      setFeedback(apiMessage(statusError));
    } finally {
      setBusy(false);
    }
  };

  const quote = data?.quote;

  return (
    <AdminShell title="Detalle presupuesto">
      <AsyncState loading={loading} error={error} />
      {quote && <>
        <div className="summary">
          <b>{quote.quote_number}</b>
          <span>{quote.email} · {quote.status}</span>
          <span>Total: {money(quote.total_cents)}</span>
        </div>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notas internas" />
        <div className="actions">
          {adminStatuses.map((status) => <button disabled={busy || quote.status === 'draft'} key={status} onClick={() => changeStatus(status)}>{status}</button>)}
        </div>
        {feedback && <p className={feedback === 'Estado actualizado' ? 'success' : 'error'}>{feedback}</p>}

        <h2>Líneas</h2>
        {data.items.length === 0 ? <div className="empty">Sin líneas.</div> : data.items.map((item) => (
          <article className="summary" key={item.id}>
            <b>{item.description}</b>
            <span>{item.quantity} × {money(item.unit_price_cents)} · Total {money(item.line_total_cents)}</span>
          </article>
        ))}

        <dl className="totals">
          <div><dt>Subtotal</dt><dd>{money(quote.subtotal_cents)}</dd></div>
          <div><dt>Descuento</dt><dd>{money(quote.discount_cents)}</dd></div>
          <div><dt>IVA</dt><dd>{money(quote.tax_cents)}</dd></div>
          <div className="grand"><dt>Total</dt><dd>{money(quote.total_cents)}</dd></div>
        </dl>
      </>}
    </AdminShell>
  );
}
