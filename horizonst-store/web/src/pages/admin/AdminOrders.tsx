import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { money } from '../../lib/money';
import type { AdminOrdersResponse } from '../../lib/types';
import { AdminShell, AsyncState } from './AdminShell';
import { submitParams } from './adminUtils';
import { useAdminLoad } from './useAdminLoad';

const statuses = ['pending', 'processing', 'completed', 'cancelled'];
const fields = ['status', 'email', 'order_number', 'quote_number'];

export default function AdminOrders() {
  const [query, setQuery] = useState('');
  const { data, error, loading } = useAdminLoad<AdminOrdersResponse>(`/api/admin/orders${query}`);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setQuery(submitParams(event.currentTarget, fields)); };
  return (
    <AdminShell title="Pedidos">
      <form className="filters" onSubmit={onSubmit}>
        <select name="status"><option value="">Estado</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
        <input name="email" placeholder="Email" />
        <input name="order_number" placeholder="Pedido" />
        <input name="quote_number" placeholder="Presupuesto" />
        <button>Filtrar</button>
      </form>
      <AsyncState loading={loading} error={error} empty={data?.orders.length === 0} />
      {data?.orders.map((order) => <article className="summary" key={order.id}>
        <b>{order.order_number}</b>
        <span>{order.quote_number} · {order.full_name} · {order.email} · {order.status} · {new Date(order.created_at).toLocaleDateString('es-ES')} · {money(order.total_cents)}</span>
        <Link to={`/admin/orders/${order.id}`}>Ver detalle</Link>
      </article>)}
    </AdminShell>
  );
}
