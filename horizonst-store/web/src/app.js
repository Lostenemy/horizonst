const money = (cents) => cents === null || cents === undefined
  ? 'Consultar'
  : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

const renderCards = (id, items, render) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items.map(render).join('');
};

fetch('/api/health')
  .then((res) => res.json())
  .then((data) => setText('health', data.status))
  .catch(() => setText('health', 'no disponible'));

fetch('/api/catalog/products')
  .then((res) => res.json())
  .then((data) => renderCards('products', data.products ?? [], (p) => `
    <article><small>${p.category}</small><h3>${p.name}</h3><strong>${money(p.price_cents)}</strong></article>`))
  .catch(() => renderCards('products', [], () => ''));

fetch('/api/catalog/saas-plans')
  .then((res) => res.json())
  .then((data) => renderCards('plans', data.saasPlans ?? [], (p) => `
    <article><small>${p.is_enterprise ? 'Enterprise' : 'Plan anual'}</small><h3>${p.name}</h3><strong>${money(p.annual_price_cents)}</strong><p>${p.max_tags ? `${p.max_tags} tags · ${p.max_gateways} gateways` : 'Capacidad a medida'}</p></article>`))
  .catch(() => renderCards('plans', [], () => ''));
