import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { money } from '../lib/money';
import type { Order, OrderDetailResponse, OrdersResponse } from '../lib/types';

const statusLabels: Record<Order['status'], string> = { pending: 'Pendiente', processing: 'En proceso', completed: 'Completado', cancelled: 'Cancelado' };

const message = (error: unknown) => error instanceof ApiError && error.status === 404 ? 'Pedido no encontrado.' : 'No se pudieron cargar los pedidos.';

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<OrdersResponse>('/api/orders').then((data) => {
      setOrders(data.orders);
      if (data.orders[0]) setSelectedId(data.orders[0].id);
    }).catch((err) => setError(message(err))).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    api<OrderDetailResponse>(`/api/orders/${selectedId}`).then(setDetail).catch((err) => setError(message(err)));
  }, [selectedId]);

  return (
    <section className="panel">
      <h1>Mis pedidos</h1>
      {error && <p className="error">{error}</p>}
      {loading ? <p>Cargando pedidos…</p> : (
        <div className="grid two-columns">
          <div>
            <h2>Listado</h2>
            {orders.length === 0 ? <p>No tienes pedidos todavía.</p> : (
              <table>
                <thead><tr><th>Pedido</th><th>Presupuesto</th><th>Estado</th><th>Total</th></tr></thead>
                <tbody>{orders.map((order) => (
                  <tr key={order.id} className={order.id === selectedId ? 'selected-row' : ''} onClick={() => setSelectedId(order.id)}>
                    <td><button type="button" className="link-button" onClick={() => setSelectedId(order.id)}>{order.order_number}</button></td>
                    <td>{order.quote_number}</td>
                    <td>{statusLabels[order.status]}</td>
                    <td>{money(order.total_cents)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div>
            <h2>Detalle</h2>
            {!detail ? <p>Selecciona un pedido.</p> : <article>
              <p><strong>Pedido:</strong> {detail.order.order_number}</p>
              <p><strong>Presupuesto:</strong> {detail.order.quote_number}</p>
              <p><strong>Estado:</strong> {statusLabels[detail.order.status]}</p>
              <p><strong>Fecha:</strong> {new Date(detail.order.created_at).toLocaleDateString('es-ES')}</p>
              {detail.order.customer_notes && <p><strong>Notas:</strong> {detail.order.customer_notes}</p>}
              <dl className="totals"><div><dt>Subtotal</dt><dd>{money(detail.order.subtotal_cents)}</dd></div><div><dt>Descuento</dt><dd>{money(detail.order.discount_cents)}</dd></div><div><dt>IVA</dt><dd>{money(detail.order.tax_cents)}</dd></div><div className="grand"><dt>Total</dt><dd>{money(detail.order.total_cents)}</dd></div></dl>
              <h3>Líneas</h3>
              {detail.items.length === 0 ? <p>Pedido sin líneas copiadas del presupuesto original.</p> : <ul>{detail.items.map((item) => <li key={item.id}>{item.description} · {item.quantity} · {money(item.line_total_cents)}</li>)}</ul>}
            </article>}
          </div>
        </div>
      )}
    </section>
  );
}
