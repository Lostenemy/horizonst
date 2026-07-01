import { useEffect, useState } from 'react';
import { ApiError, api, postJson } from '../lib/api';
import { money } from '../lib/money';
import type { CartItem, Quote } from '../lib/types';

type QuoteHistory = { id: string; old_status: string; new_status: string; comment: string | null; created_at: string };
type QuoteDetail = { quote: Quote; items: CartItem[]; history: QuoteHistory[] };

const statusLabels: Record<Quote['status'], string> = {
  draft: 'Borrador', submitted: 'Enviado', in_review: 'En revisión', sent: 'Recibido', accepted: 'Aceptado', rejected: 'Rechazado', cancelled: 'Cancelado'
};

const errorMessage = (error: unknown) => {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'No tienes permiso para acceder a esta operación.';
    if (error.status === 404) return 'Presupuesto no encontrado.';
    if (error.status === 409) return 'El presupuesto ya no está en estado recibido y no puede aceptarse o rechazarse.';
    if (error.status === 400) return 'Revisa el comentario: máximo 5000 caracteres y sin campos desconocidos.';
  }
  return 'No se pudo completar la operación. Inténtalo de nuevo más tarde.';
};

export default function Quotes() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadQuotes = async () => {
    const data = await api<{ quotes: Quote[] }>('/api/quotes');
    setQuotes(data.quotes);
    if (!selectedId && data.quotes[0]) setSelectedId(data.quotes[0].id);
  };

  const loadDetail = async (id: string) => {
    const data = await api<QuoteDetail>(`/api/quotes/${id}`);
    setDetail(data);
    setComment('');
  };

  useEffect(() => {
    setLoading(true);
    loadQuotes().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    loadDetail(selectedId).catch((err) => setError(errorMessage(err)));
  }, [selectedId]);

  const decide = async (action: 'accept' | 'reject') => {
    if (!detail) return;
    const verb = action === 'accept' ? 'aceptar' : 'rechazar';
    if (!window.confirm(`¿Seguro que quieres ${verb} el presupuesto ${detail.quote.quote_number}?`)) return;
    try {
      setError(null);
      await postJson<{ quote: Quote }>(`/api/quotes/${detail.quote.id}/${action}`, comment.trim() ? { comment } : {});
      await loadQuotes();
      await loadDetail(detail.quote.id);
    } catch (err) { setError(errorMessage(err)); }
  };

  return (
    <section className="panel">
      <h1>Mis presupuestos</h1>
      {error && <p className="error">{error}</p>}
      {loading ? <p>Cargando presupuestos…</p> : (
        <div className="grid two-columns">
          <div>
            <h2>Listado</h2>
            {quotes.length === 0 ? <p>No tienes presupuestos todavía.</p> : (
              <table>
                <thead><tr><th>Número</th><th>Fecha</th><th>Estado</th><th>Total</th></tr></thead>
                <tbody>{quotes.map((quote) => (
                  <tr key={quote.id} className={quote.id === selectedId ? 'selected-row' : ''} onClick={() => setSelectedId(quote.id)}>
                    <td><button type="button" className="link-button" onClick={() => setSelectedId(quote.id)}>{quote.quote_number}</button></td>
                    <td>{new Date(quote.created_at).toLocaleDateString('es-ES')}</td>
                    <td>{statusLabels[quote.status]}</td>
                    <td>{money(quote.total_cents)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div>
            <h2>Detalle</h2>
            {!detail ? <p>Selecciona un presupuesto.</p> : (
              <article>
                <p><strong>Número:</strong> {detail.quote.quote_number}</p>
                <p><strong>Estado:</strong> {statusLabels[detail.quote.status]}</p>
                <p><strong>Total:</strong> {money(detail.quote.total_cents)}</p>
                <p><a href={`/api/quotes/${detail.quote.id}/pdf`} target="_blank" rel="noreferrer">Descargar PDF</a></p>
                <h3>Líneas</h3>
                <ul>{detail.items.map((item) => <li key={item.id}>{item.description} · {item.quantity} · {money(item.line_total_cents)}</li>)}</ul>
                <h3>Historial</h3>
                <ul>{detail.history.map((entry) => <li key={entry.id}>{entry.old_status} → {entry.new_status}{entry.comment ? ` · ${entry.comment}` : ''}</li>)}</ul>
                {detail.quote.status === 'sent' && (
                  <form onSubmit={(event) => event.preventDefault()}>
                    <label>Comentario opcional<textarea value={comment} maxLength={5000} onChange={(event) => setComment(event.target.value)} /></label>
                    <div className="actions">
                      <button type="button" onClick={() => decide('accept')}>Aceptar presupuesto</button>
                      <button type="button" className="secondary" onClick={() => decide('reject')}>Rechazar presupuesto</button>
                    </div>
                  </form>
                )}
              </article>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
