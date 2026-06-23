import { useState } from 'react';
import { patchJson, postJson } from '../../lib/api';
import { money } from '../../lib/money';
import type { SaasPlan } from '../../lib/types';
import { AdminShell, AsyncState } from './AdminShell';
import { apiMessage } from './adminUtils';
import CatalogForm, { SaasPlanFormValue } from './CatalogForm';
import { useAdminLoad } from './useAdminLoad';
import type { SaasPlansResponse } from './types';

export default function AdminSaasPlans() {
  const { data, error, loading, load } = useAdminLoad<SaasPlansResponse>('/api/admin/saas-plans');
  const [editing, setEditing] = useState<SaasPlanFormValue | null>(null);
  const [feedback, setFeedback] = useState('');

  const save = async (value: SaasPlanFormValue) => {
    try {
      if (value.id) await patchJson(`/api/admin/saas-plans/${value.id}`, value);
      else await postJson('/api/admin/saas-plans', value);
      setEditing(null);
      setFeedback('Guardado');
      load();
    } catch (saveError) {
      setFeedback(apiMessage(saveError));
    }
  };

  const edit = (plan: SaasPlan) => setEditing(plan);
  const planPrice = (plan: SaasPlan) => plan.is_enterprise ? 'Enterprise' : money(plan.annual_price_cents);

  return (
    <AdminShell title="Planes SaaS">
      <button onClick={() => setEditing({ is_active: true, is_enterprise: false })}>Crear plan</button>
      {feedback && <p className={feedback === 'Guardado' ? 'success' : 'error'}>{feedback}</p>}
      {editing && <CatalogForm kind="saas-plan" value={editing} onSubmit={save} />}
      <AsyncState loading={loading} error={error} empty={data?.saasPlans.length === 0} />
      {data?.saasPlans.map((plan) => (
        <article className="summary" key={plan.id}>
          <b>{plan.code} · {plan.name}</b>
          <span>{plan.is_active ? 'activo' : 'inactivo'} · {planPrice(plan)}</span>
          <button onClick={() => edit(plan)}>Editar / activar-desactivar</button>
        </article>
      ))}
    </AdminShell>
  );
}
