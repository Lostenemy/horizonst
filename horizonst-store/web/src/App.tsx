import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Product = { sku: string; name: string; category: string; price_cents: number };
type SaasPlan = { code: string; name: string; annual_price_cents: number | null; max_tags: number | null; max_gateways: number | null; is_enterprise: boolean };

const money = (cents: number | null) => cents === null ? 'Consultar' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);

function App() {
  const [health, setHealth] = useState('comprobando');
  const [products, setProducts] = useState<Product[]>([]);
  const [plans, setPlans] = useState<SaasPlan[]>([]);

  useEffect(() => {
    void fetch('/api/health').then((res) => res.json()).then((data) => setHealth(data.status)).catch(() => setHealth('no disponible'));
    void fetch('/api/catalog/products').then((res) => res.json()).then((data) => setProducts(data.products ?? [])).catch(() => setProducts([]));
    void fetch('/api/catalog/saas-plans').then((res) => res.json()).then((data) => setPlans(data.saasPlans ?? [])).catch(() => setPlans([]));
  }, []);

  return <main className="shell">
    <section className="hero">
      <p className="eyebrow">HorizonST Store</p>
      <h1>Tienda privada para soluciones HorizonST</h1>
      <p>Base técnica inicial para clientes, distribuidores, catálogo, presupuestos y administración comercial.</p>
      <div className="actions"><button>Iniciar sesión</button><button className="secondary">Crear cuenta</button></div>
      <p className="notice">Pagos online todavía no disponibles. Las compras se gestionan mediante solicitud de presupuesto.</p>
      <span className="health">Backend health: {health}</span>
    </section>
    <section><h2>Productos iniciales</h2><div className="grid">{products.map((p) => <article key={p.sku}><small>{p.category}</small><h3>{p.name}</h3><strong>{money(p.price_cents)}</strong></article>)}</div></section>
    <section><h2>Planes SaaS</h2><div className="grid">{plans.map((p) => <article key={p.code}><small>{p.is_enterprise ? 'Enterprise' : 'Plan anual'}</small><h3>{p.name}</h3><strong>{money(p.annual_price_cents)}</strong><p>{p.max_tags ? `${p.max_tags} tags · ${p.max_gateways} gateways` : 'Capacidad a medida'}</p></article>)}</div></section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
