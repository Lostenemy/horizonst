import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import { useAuth } from '../components/AuthProvider';
import { api, postJson } from '../lib/api';
import { money } from '../lib/money';
import type { Cart, Product } from '../lib/types';

export default function Catalog() {
  const { authenticated } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    api<{ products: Product[] }>('/api/catalog/products')
      .then((data) => setProducts(data.products))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo'))
      .finally(() => setLoading(false));
  }, []);

  async function addToCart(productId: string) {
    setAddingId(productId);
    try {
      await postJson<Cart>('/api/cart/items', { item_type: 'product', product_id: productId, quantity: 1 });
      setMessage('Producto añadido al carrito.');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir al carrito');
    } finally {
      setAddingId(null);
    }
  }

  return (
    <section>
      <div className="section-heading"><h1>Catálogo</h1><p className="muted">Hardware HorizonST disponible para solicitud de presupuesto.</p></div>
      {message && <p className="success">{message} <Link to="/cart">Ver carrito</Link></p>}
      <ErrorMessage message={error} />
      {loading ? <Loading /> : products.length === 0 ? <p className="empty">No hay productos activos publicados.</p> : (
        <div className="cards">
          {products.map((product) => (
            <article className="card" key={product.id}>
              <small>{product.category ?? 'Producto'}</small>
              <h2>{product.name}</h2>
              <p>{product.description ?? 'Sin descripción disponible.'}</p>
              <strong>{money(product.price_cents)}</strong>
              {authenticated ? (
                <button type="button" disabled={addingId === product.id} onClick={() => addToCart(product.id)}>
                  {addingId === product.id ? 'Añadiendo…' : 'Añadir al carrito'}
                </button>
              ) : <Link className="btn secondary" to="/login" state={{ from: '/catalog' }}>Inicia sesión para añadir</Link>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
