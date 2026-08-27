import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { downloadFile } from '../../lib/api';
import { money } from '../../lib/money';
import type { AdminOrderDetailResponse } from '../../lib/types';
import { AdminShell, AsyncState } from './AdminShell';
import { useAdminLoad } from './useAdminLoad';
import { apiMessage } from './adminUtils';

export default function AdminOrderDetail() {
  const { id } = useParams();
  const { data, error, loading } = useAdminLoad<AdminOrderDetailResponse>(`/api/admin/orders/${id}`);
  const [downloadError, setDownloadError] = useState('');
  const order = data?.order;
  return (
    <AdminShell title="Detalle pedido">
      <AsyncState loading={loading} error={error} />
      {order && <>
        <div className="summary"><b>{order.order_number}</b><span><span className={`commercial-status ${order.status}`}>{order.status}</span> · {new Date(order.created_at).toLocaleString()}</span><span>{order.full_name} · {order.email} · {order.role}</span><span>Presupuesto: {order.quote_number}</span></div>
        <button type="button" onClick={() => downloadFile(`/api/admin/orders/${id}/pdf`, `ALBARAN-${order.order_number}.pdf`).catch((error) => setDownloadError(apiMessage(error)))}>Descargar albarán</button>
        {downloadError && <p className="error">{downloadError}</p>}
        {order.customer_notes && <p><strong>Notas de cliente:</strong> {order.customer_notes}</p>}
        <dl className="totals"><div><dt>Subtotal</dt><dd>{money(order.subtotal_cents)}</dd></div><div><dt>Descuento</dt><dd>{money(order.discount_cents)}</dd></div><div><dt>IVA</dt><dd>{money(order.tax_cents)}</dd></div><div className="grand"><dt>Total</dt><dd>{money(order.total_cents)}</dd></div></dl>
        <h2>Líneas</h2>
        {data.items.length === 0 ? <div className="empty">Sin líneas.</div> : data.items.map((item) => <article className="summary" key={item.id}><b>{item.description}</b><span>{item.quantity} x {money(item.unit_price_cents)} · DTO {item.discount_percent}% · IVA {item.tax_rate}% · Total {money(item.line_total_cents)}</span></article>)}
      </>}
    </AdminShell>
  );
}
