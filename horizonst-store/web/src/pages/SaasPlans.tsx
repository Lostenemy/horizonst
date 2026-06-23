import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import { useAuth } from '../components/AuthProvider';
import { api, postJson } from '../lib/api';
import { money } from '../lib/money';
import type { Cart, SaasPlan } from '../lib/types';

export default function SaasPlans() {
  const { authenticated } = useAuth();
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
      <div className="section-heading"><h1>Planes SaaS</h1><p className="muted">Planes anuales. Enterprise se gestiona por contacto comercial.</p></div>
      {message && <p className="success">{message} <Link to="/cart">Ver carrito</Link></p>}
      <ErrorMessage message={error} />
      {loading ? <Loading /> : plans.length === 0 ? <p className="empty">No hay planes SaaS activos.</p> : (
        <div className="cards">
          {plans.map((plan) => (
            <article className="card" key={plan.id}>
              <small>{plan.is_enterprise ? 'Enterprise' : 'Plan anual'}</small>
              <h2>{plan.name}</h2>
              <p>{plan.description ?? 'Sin descripción disponible.'}</p>
              <strong>{plan.is_enterprise ? 'Contactar' : money(plan.annual_price_cents)}</strong>
              {plan.max_tags && <p>{plan.max_tags} tags · {plan.max_gateways} gateways</p>}
              {plan.is_enterprise ? <Link className="btn secondary" to="/dashboard">Contactar</Link> : authenticated ? (
                <button type="button" disabled={addingId === plan.id} onClick={() => addToCart(plan.id)}>{addingId === plan.id ? 'Añadiendo…' : 'Añadir al carrito'}</button>
              ) : <Link className="btn secondary" to="/login" state={{ from: '/saas-plans' }}>Inicia sesión para añadir</Link>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
