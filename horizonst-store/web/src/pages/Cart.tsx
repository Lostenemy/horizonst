import { ChangeEvent, useEffect, useState } from 'react';
import { api, patchJson } from '../lib/api';
import { money } from '../lib/money';
import type { Cart as CartModel } from '../lib/types';

export default function Cart() {
  const [cart, setCart] = useState<CartModel | null>(null);
  const [message, setMessage] = useState('');

  const load = () => api<CartModel>('/api/cart').then(setCart);

  useEffect(() => {
    load();
  }, []);

  async function updateQuantity(id: string, event: ChangeEvent<HTMLInputElement>) {
    const quantity = Number(event.target.value);
    if (quantity > 0) setCart(await patchJson<CartModel>(`/api/cart/items/${id}`, { quantity }));
  }

  async function removeItem(id: string) {
    setCart(await api<CartModel>(`/api/cart/items/${id}`, { method: 'DELETE' }));
  }

  async function submitQuote() {
    setCart(await api<CartModel>('/api/cart/submit', { method: 'POST' }));
    setMessage('Solicitud de presupuesto enviada');
  }

  return (
    <section className="panel">
      <h1>Carrito</h1>
      {cart?.items.map((item) => (
        <div className="line" key={item.id}>
          <span>{item.description}</span>
          <input
            type="number"
            min="1"
            value={item.quantity}
            onChange={(event) => updateQuantity(item.id, event)}
          />
          <b>{money(item.line_total_cents)}</b>
          <button type="button" onClick={() => removeItem(item.id)}>Eliminar</button>
        </div>
      ))}
      <h2>Total: {money(cart?.quote.total_cents)}</h2>
      <button type="button" disabled={!cart?.items.length} onClick={submitQuote}>
        Enviar solicitud de presupuesto
      </button>
      {message && <p className="success">{message}</p>}
    </section>
  );
}
