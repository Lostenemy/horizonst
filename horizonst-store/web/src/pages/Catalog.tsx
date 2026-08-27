import { useEffect, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import { api, postJson } from '../lib/api';
import { canAutoPricePack, canAutoPriceSaasPlan } from '../lib/commercialPricing';
import { coverageLabel } from '../lib/coverage';
import { money } from '../lib/money';
import type { Cart, Pack, SaasPlan } from '../lib/types';

const tiers = ['starter', 'professional', 'enterprise'] as const;
const tierLabels = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' } as const;

export default function Catalog() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [plans, setPlans] = useState<SaasPlan[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<{ packs: Pack[] }>('/api/catalog/packs'), api<{ saasPlans: SaasPlan[] }>('/api/catalog/saas-plans')])
      .then(([packData, planData]) => { setPacks(packData.packs); setPlans(planData.saasPlans); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo'))
      .finally(() => setLoading(false));
  }, []);

  async function addToCart(kind: 'pack' | 'saas_plan', id: string) {
    setAddingId(id);
    try {
      await postJson<Cart>('/api/cart/items', kind === 'pack' ? { item_type: 'pack', pack_id: id, quantity: 1 } : { item_type: 'saas_plan', saas_plan_id: id, quantity: 1 });
      setMessage('Artículo añadido al carrito.'); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo añadir al carrito'); }
    finally { setAddingId(null); }
  }

  const professional = plans.find((plan) => plan.code === 'professional');

  return (
    <section className="catalog-page">
      <div className="section-heading"><div><small>Soluciones HorizonST</small><h1>Catálogo</h1><p className="muted">Hardware y plataforma web emparejados por nivel. Puedes seleccionar cada elemento por separado.</p></div></div>
      {message && <p className="success">{message} <a href="/cart">Ver carrito</a></p>}
      <ErrorMessage message={error} />
      {loading ? <Loading /> : (
        <div className="catalog-tiers">
          {tiers.map((tier) => {
            const pack = packs.find((item) => item.code === tier);
            const plan = plans.find((item) => item.code === tier);
            if (!pack && !plan) return null;
            const enterpriseExtraTags = tier === 'enterprise' && plan?.max_tags && professional?.max_tags ? plan.max_tags - professional.max_tags : null;
            const enterpriseExtraGateways = tier === 'enterprise' && plan?.max_gateways && professional?.max_gateways ? plan.max_gateways - professional.max_gateways : null;
            return (
              <section className={`catalog-tier ${tier}`} key={tier}>
                <header><span>Pack {tierLabels[tier]}</span><h2>{tierLabels[tier]}</h2><p>Combinación natural de hardware y servicio web para este nivel.</p></header>
                <div className="catalog-pair">
                  {pack && <article className="catalog-card hardware-card">
                    <small>Hardware {tierLabels[tier]}</small><h3>{pack.name}</h3><p>{pack.description ?? 'Configuración de hardware HorizonST.'}</p>
                    {coverageLabel(pack.coverage_square_meters) && <p><strong>{coverageLabel(pack.coverage_square_meters)}</strong></p>}
                    <ul>{pack.items.map((item) => <li key={item.product_id}>{item.quantity} × {item.name}</li>)}</ul>
                    <div className="catalog-card-footer"><strong>{money(pack.price_cents)}</strong><button type="button" disabled={!canAutoPricePack(pack) || addingId === pack.id} onClick={() => addToCart('pack', pack.id)}>{addingId === pack.id ? 'Añadiendo…' : 'Añadir hardware'}</button></div>
                  </article>}
                  {plan && <article className="catalog-card web-card">
                    <small>Web {tierLabels[tier]}</small><h3>{plan.name}</h3><p>{plan.description || 'Servicio web HorizonST adaptado a este nivel de operación.'}</p>
                    {enterpriseExtraTags && enterpriseExtraGateways ? <>
                      <p className="plan-capacity"><strong>+{enterpriseExtraTags} tags · +{enterpriseExtraGateways} gateways</strong></p>
                      <p className="tier-increment">Capacidad adicional sobre Professional</p>
                    </> : <>
                      <p className="plan-capacity"><strong>{plan.max_tags ?? '—'} tags · {plan.max_gateways ?? '—'} gateways</strong></p>
                      <p className="tier-increment" aria-hidden="true">Capacidad incluida en el plan</p>
                    </>}
                    <div className="catalog-card-footer"><strong>{canAutoPriceSaasPlan(plan) ? money(plan.annual_price_cents) : 'Consultar'}</strong><button type="button" disabled={!canAutoPriceSaasPlan(plan) || addingId === plan.id} onClick={() => addToCart('saas_plan', plan.id)}>{addingId === plan.id ? 'Añadiendo…' : 'Añadir plan web'}</button></div>
                  </article>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
