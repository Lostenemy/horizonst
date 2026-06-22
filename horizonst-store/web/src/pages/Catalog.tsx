import { useEffect, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import { useAuth } from '../components/AuthProvider';
import { api, postJson } from '../lib/api';
import { money } from '../lib/money';
import type { Product } from '../lib/types';

export default function Catalog() {
  const { authenticated } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ products: Product[] }>('/api/catalog/products').then((data) => setProducts(data.products));
  }, []);

  async function addToCart(productId: string) {
    try {
      await postJson('/api/cart/items', { item_type: 'product', product_id: productId, quantity: 1 });
      setMessage('Producto añadido al carrito');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir al carrito');
    }
  }

  return (
    <section>
      <h1>Catálogo</h1>
      {message && <p className="success">{message}</p>}
      <ErrorMessage message={error} />
      <div className="cards">
        {products.map((product) => (
          <article className="card" key={product.id}>
            <small>{product.category}</small>
            <h2>{product.name}</h2>
            <p>{product.description}</p>
            <strong>{money(product.price_cents)}</strong>
            {authenticated && <button type="button" onClick={() => addToCart(product.id)}>Añadir al carrito</button>}
          </article>
        ))}
      </div>
    </section>
  );
}
