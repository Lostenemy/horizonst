import { useEffect, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import { api, postJson } from '../lib/api';
import { canAutoPriceSaasPlan } from '../lib/commercialPricing';
import { money } from '../lib/money';
import type { Cart, SaasPlan } from '../lib/types';

export default function SaasPlans() {
  const [plans, setPlans] = useState<SaasPlan[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    api<{ saasPlans: SaasPlan[] }>('/api/catalog/saas-plans')
      .then((data) => setPlans(data.saasPlans))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudieron cargar los planes'))
      .finally(() => setLoading(false));
  }, []);

  async function addToCart(planId: string) {
    setAddingId(planId);
    try {
      await postJson<Cart>('/api/cart/items', { item_type: 'saas_plan', saas_plan_id: planId, quantity: 1 });
      setMessage('Plan añadido al carrito.');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir el plan');
    } finally {
      setAddingId(null);
    }
  }

  return (
    <section>
      <div className="section-heading"><h1>Planes web</h1><p className="muted">Planes anuales para la plataforma HorizonST.</p></div>
      {message && <p className="success">{message} <a href="/cart">Ver carrito</a></p>}
      <ErrorMessage message={error} />
      {loading ? <Loading /> : plans.length === 0 ? <p className="empty">No hay planes web activos.</p> : (
        <div className="cards">
          {plans.map((plan) => {
            const canAdd = canAutoPriceSaasPlan(plan);
            return (
              <article className="card" key={plan.id}>
                <small>Plan web anual</small>
                <h2>{plan.name}</h2>
                <p>{plan.description ?? 'Sin descripción disponible.'}</p>
                <strong>{canAdd ? money(plan.annual_price_cents) : 'Contactar'}</strong>
                {plan.max_tags && <p>{plan.max_tags} tags · {plan.max_gateways} gateways</p>}
                <button type="button" disabled={!canAdd || addingId === plan.id} onClick={() => addToCart(plan.id)}>{canAdd ? (addingId === plan.id ? 'Añadiendo…' : 'Añadir al carrito') : 'Contactar para presupuesto'}</button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
