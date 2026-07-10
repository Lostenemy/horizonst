import { useEffect, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import { api, postJson } from '../lib/api';
import { money } from '../lib/money';
import type { Cart, Pack } from '../lib/types';

export default function Catalog() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    api<{ packs: Pack[] }>('/api/catalog/packs')
      .then((data) => setPacks(data.packs))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo'))
      .finally(() => setLoading(false));
  }, []);

  async function addToCart(packId: string) {
    setAddingId(packId);
    try {
      await postJson<Cart>('/api/cart/items', { item_type: 'pack', pack_id: packId, quantity: 1 });
      setMessage('Pack añadido al carrito.');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir al carrito');
    } finally {
      setAddingId(null);
    }
  }

  return (
    <section>
      <div className="section-heading"><h1>Packs de hardware</h1><p className="muted">Configuraciones comerciales para solicitud de presupuesto.</p></div>
      {message && <p className="success">{message} <a href="/cart">Ver carrito</a></p>}
      <ErrorMessage message={error} />
      {loading ? <Loading /> : packs.length === 0 ? <p className="empty">No hay packs activos publicados.</p> : (
        <div className="cards">
          {packs.map((pack) => (
            <article className="card" key={pack.id}>
              <small>Pack comercial</small>
              <h2>{pack.name}</h2>
              <p>{pack.description ?? 'Configuración de hardware HorizonST.'}</p>
              <ul>{pack.items.map((item) => <li key={item.product_id}>{item.quantity} × {item.name}</li>)}</ul>
              <strong>{money(pack.price_cents)}</strong>
              <button type="button" disabled={addingId === pack.id} onClick={() => addToCart(pack.id)}>
                {addingId === pack.id ? 'Añadiendo…' : 'Añadir pack al carrito'}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
