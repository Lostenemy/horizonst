import { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { api, postJson } from '../lib/api';
import { money } from '../lib/money';
import type { SaasPlan } from '../lib/types';

export default function SaasPlans() {
  const { authenticated } = useAuth();
  const [plans, setPlans] = useState<SaasPlan[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api<{ saasPlans: SaasPlan[] }>('/api/catalog/saas-plans').then((data) => setPlans(data.saasPlans));
  }, []);

  async function addToCart(planId: string) {
    await postJson('/api/cart/items', { item_type: 'saas_plan', saas_plan_id: planId, quantity: 1 });
    setMessage('Plan añadido al carrito');
  }

  return (
    <section>
      <h1>Planes SaaS</h1>
      {message && <p className="success">{message}</p>}
      <div className="cards">
        {plans.map((plan) => (
          <article className="card" key={plan.id}>
            <small>{plan.is_enterprise ? 'Enterprise' : 'Plan anual'}</small>
            <h2>{plan.name}</h2>
            <p>{plan.description}</p>
            <strong>{plan.is_enterprise ? 'Contactar' : money(plan.annual_price_cents)}</strong>
            {plan.max_tags && <p>{plan.max_tags} tags · {plan.max_gateways} gateways</p>}
            {authenticated && !plan.is_enterprise && (
              <button type="button" onClick={() => addToCart(plan.id)}>Añadir al carrito</button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
