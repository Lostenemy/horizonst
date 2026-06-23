import { useState } from 'react';
import { patchJson, postJson } from '../../lib/api';
import { money } from '../../lib/money';
import type { Product } from '../../lib/types';
import { AdminShell, AsyncState } from './AdminShell';
import { apiMessage } from './adminUtils';
import CatalogForm, { ProductFormValue } from './CatalogForm';
import { useAdminLoad } from './useAdminLoad';
import type { ProductsResponse } from './types';

export default function AdminProducts() {
  const { data, error, loading, load } = useAdminLoad<ProductsResponse>('/api/admin/products');
  const [editing, setEditing] = useState<ProductFormValue | null>(null);
  const [feedback, setFeedback] = useState('');

  const save = async (value: ProductFormValue) => {
    try {
      if (value.id) await patchJson(`/api/admin/products/${value.id}`, value);
      else await postJson('/api/admin/products', value);
      setEditing(null);
      setFeedback('Guardado');
      load();
    } catch (saveError) {
      setFeedback(apiMessage(saveError));
    }
  };

  const edit = (product: Product) => setEditing(product);

  return (
    <AdminShell title="Productos">
      <button onClick={() => setEditing({ is_active: true, category: 'hardware', price_cents: 0 })}>Crear producto</button>
      {feedback && <p className={feedback === 'Guardado' ? 'success' : 'error'}>{feedback}</p>}
      {editing && <CatalogForm kind="product" value={editing} onSubmit={save} />}
      <AsyncState loading={loading} error={error} empty={data?.products.length === 0} />
      {data?.products.map((product) => (
        <article className="summary" key={product.id}>
          <b>{product.sku} · {product.name}</b>
          <span>{product.is_active ? 'activo' : 'inactivo'} · {money(product.price_cents)}</span>
          <button onClick={() => edit(product)}>Editar / activar-desactivar</button>
        </article>
      ))}
    </AdminShell>
  );
}
