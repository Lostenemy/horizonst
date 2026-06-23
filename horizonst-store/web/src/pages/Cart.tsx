import { ChangeEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import { api, patchJson } from '../lib/api';
import { money } from '../lib/money';
import type { Cart as CartModel } from '../lib/types';

export default function Cart() {
  const [cart, setCart] = useState<CartModel | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api<CartModel>('/api/cart').then(setCart);

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar el carrito')).finally(() => setLoading(false));
  }, []);

  async function updateQuantity(id: string, event: ChangeEvent<HTMLInputElement>) {
    const quantity = Number(event.target.value);
    if (!Number.isInteger(quantity) || quantity < 1) return;
    setBusy(id);
    try { setCart(await patchJson<CartModel>(`/api/cart/items/${id}`, { quantity })); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo actualizar la cantidad'); }
    finally { setBusy(null); }
  }

  async function removeItem(id: string) {
    setBusy(id);
    try { setCart(await api<CartModel>(`/api/cart/items/${id}`, { method: 'DELETE' })); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo eliminar la línea'); }
    finally { setBusy(null); }
  }

  async function submitQuote() {
    setBusy('submit');
    try {
      setCart(await api<CartModel>('/api/cart/submit', { method: 'POST' }));
      setMessage('Solicitud de presupuesto enviada. El equipo comercial revisará tu solicitud.');
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo enviar la solicitud'); }
    finally { setBusy(null); }
  }

  if (loading) return <section className="panel"><h1>Carrito</h1><Loading /></section>;

  const isEmpty = !cart || cart.items.length === 0;
  const submitted = cart?.quote.status !== 'draft';

  return (
    <section className="panel">
      <h1>Carrito</h1>
      <ErrorMessage message={error} />
      {message && <p className="success">{message}</p>}
      {isEmpty ? (
        <div className="empty"><p>Tu carrito está vacío.</p><Link className="btn" to="/catalog">Ir al catálogo</Link></div>
      ) : (
        <>
          {submitted && <p className="success">Presupuesto {cart.quote.quote_number} enviado con estado {cart.quote.status}.</p>}
          {cart.items.map((item) => (
            <div className="line" key={item.id}>
              <span><b>{item.description}</b><small>{item.item_type === 'saas_plan' ? ' SaaS' : ' Producto'}</small></span>
              <input aria-label={`Cantidad de ${item.description}`} type="number" min="1" value={item.quantity} disabled={busy === item.id || submitted} onChange={(event) => updateQuantity(item.id, event)} />
              <b>{money(item.line_total_cents)}</b>
              <button type="button" disabled={busy === item.id || submitted} onClick={() => removeItem(item.id)}>Eliminar</button>
            </div>
          ))}
          <dl className="totals">
            <div><dt>Subtotal</dt><dd>{money(cart.quote.subtotal_cents)}</dd></div>
            <div><dt>Descuento</dt><dd>-{money(cart.quote.discount_cents)}</dd></div>
            <div><dt>IVA</dt><dd>{money(cart.quote.tax_cents)}</dd></div>
            <div className="grand"><dt>Total</dt><dd>{money(cart.quote.total_cents)}</dd></div>
          </dl>
          <button type="button" disabled={isEmpty || submitted || busy === 'submit'} onClick={submitQuote}>{busy === 'submit' ? 'Enviando…' : 'Enviar solicitud de presupuesto'}</button>
        </>
      )}
    </section>
  );
}
