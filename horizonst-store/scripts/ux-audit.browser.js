(async (page) => {
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  // Ejecutar con playwright-cli run-code --filename, contra vite preview local.
  // Toda API se simula y cualquier destino externo se aborta.
  const base = 'http://127.0.0.1:4173';
  const check = (value, message) => { if (!value) throw new Error(message); };
  const parseUrl = (value) => {
    const match = /^https?:\/\/([^/:]+)(?::\d+)?([^?]*)(\?.*)?$/.exec(value);
    return { hostname: match?.[1], pathname: match?.[2] || '/', search: match?.[3] || '' };
  };
  let role = 'admin';
  let campaignActive = true;
  let leadRequests = 0;
  let delayedFilter;
  let delayRejected = false;
  const apiCalls = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const quote = { id: '11111111-1111-4111-8111-111111111111', user_id: 'fixture', quote_number: 'Q-FIXTURE', status: 'submitted', email: 'fixture@example.test', total_cents: 393250, created_at: '2026-09-28T10:00:00Z' };
  const plans = ['starter', 'professional', 'enterprise'].map((code, i) => ({ id: `plan-${i}`, code, name: code[0].toUpperCase() + code.slice(1), description: 'Servicio web de prueba', annual_price_cents: [60000, 90000, 120000][i], tax_rate: 21, max_tags: [10, 20, 40][i], max_gateways: [5, 10, 20][i], is_active: true, is_enterprise: false }));
  const packs = ['starter', 'professional', 'enterprise'].map((code, i) => ({ id: `pack-${i}`, code, name: `PACK ${plans[i].name}`, description: 'Hardware de prueba', price_cents: [325000, 650000, 1299500][i], tax_rate: 21, is_active: true, coverage_square_meters: [500, 1000, 2000][i], items: [{ product_id: 'p', quantity: 5, name: 'Puntos de comunicación' }] }));
  let cartItems = [];
  const cart = () => ({ quote: { ...quote, status: 'draft', subtotal_cents: cartItems.length ? 325000 * cartItems[0].quantity : 0, discount_cents: 0, tax_cents: cartItems.length ? 68250 * cartItems[0].quantity : 0, total_cents: cartItems.length ? 393250 * cartItems[0].quantity : 0 }, items: cartItems });
  await page.addInitScript(() => localStorage.setItem('horizonst.accessToken', 'synthetic-browser-session'));
  await page.route('**/*', async (route) => {
    const request = route.request(); const url = parseUrl(request.url());
    if (!['127.0.0.1', 'horizonst.es'].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      apiCalls.push(`${request.method()} ${url.pathname}${url.search}`);
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname === '/api/auth/me') return reply({ user: { id: `fixture-${role}`, full_name: 'Usuario ficticio', email: 'fixture@example.test', role, status: 'active' } });
      if (url.pathname === '/api/catalog/saas-plans') return reply({ saasPlans: plans });
      if (url.pathname === '/api/catalog/packs') return reply({ packs });
      if (url.pathname === '/api/public/prereservation/campaign') return reply({ campaign: 'fixture', endAt: '2027-01-01T22:59:59.999Z', active: campaignActive, codes: plans.map((p) => p.code) });
      if (url.pathname === '/api/leads') { leadRequests++; return reply({ ok: true }); }
      if (url.pathname === '/api/public/prereservation/access') return reply({ error: 'Campaign expired' }, 410);
      if (url.pathname === '/api/admin/quotes') {
        if (delayRejected && url.search.includes('status=rejected')) {
          await new Promise((resolve) => { delayedFilter = resolve; });
        }
        return reply({ quotes: url.search ? [] : [quote] });
      }
      if (url.pathname === '/api/quotes') return reply({ quotes: [] });
      if (url.pathname === '/api/cart/items' && request.method() === 'POST') {
        cartItems = [{ id: 'item', description: 'PACK Starter: 5 gateways: hasta 500 m²', item_type: 'pack', quantity: 1, tax_rate: 21, line_total_cents: 393250 }]; return reply(cart());
      }
      if (url.pathname === '/api/cart/items/item') {
        if (request.method() === 'DELETE') cartItems = [];
        else { const { quantity } = request.postDataJSON(); cartItems[0].quantity = quantity; cartItems[0].line_total_cents = quantity * 393250; }
        return reply(cart());
      }
      if (url.pathname === '/api/cart') return reply(cart());
      if (url.pathname === '/api/admin/dashboard') return reply({ metrics: { customers_registered: 1, distributors_pending: 1, distributors_approved: 0, quotes_submitted: 1, quotes_in_review: 0, quotes_sent: 0, quotes_accepted: 0, open_value_cents: 393250, accepted_value_cents: 0 }, latestAudit: [{ id: 'event', action: 'cart_item_removed', entity_type: 'quote_item', created_at: quote.created_at }], latestQuotes: [quote], latestDistributors: [] });
      return reply({ error: 'Unexpected fixture request' }, 500);
    }
    if (url.hostname === 'horizonst.es') {
      const response = await route.fetch({ url: `${base}${url.pathname}${url.search}` });
      return route.fulfill({ response });
    }
    return route.continue();
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://horizonst.es/');
  await page.getByRole('link', { name: 'Recibir la guía gratuita', exact: true }).click();
  const heading = await page.locator('#guide-request-title').boundingBox();
  const emailBox = await page.locator('#guia-solicitud input[type=email]').boundingBox();
  const header = await page.locator('.lp-nav').boundingBox();
  check(heading && emailBox && heading.y >= header.height - 1 && emailBox.y + emailBox.height < 844, 'La CTA debe mostrar título y email debajo de la cabecera');
  await page.screenshot({ path: 'output/playwright/auditoria-guia-390.png' });
  const contrast = await page.locator('.lp-privacy a').first().evaluate((element) => {
    const color = getComputedStyle(element).color.match(/\d+/g).map(Number);
    const luminance = (rgb) => rgb.map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    return [[18, 57, 75], [12, 42, 58]].map((bg) => (luminance(color) + .05) / (luminance(bg) + .05));
  });
  check(contrast.every((ratio) => ratio >= 4.5), 'Contraste insuficiente en privacidad');
  await page.getByLabel('Email profesional', { exact: true }).fill('fixture@example.test');
  await page.locator('#guia-solicitud input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Recibir la guía por email' }).click();
  await page.getByText('Revisa tu correo para acceder a la guía.').waitFor();
  check(leadRequests === 1, 'El formulario debe enviar una sola petición simulada');
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const pathname of ['/', '/planes', '/info-faqs']) {
      await page.goto(`http://horizonst.es${pathname}`);
      if (pathname === '/planes') await page.getByRole('button', { name: 'Prerreservar con 5 % de descuento' }).first().waitFor();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow público ${pathname} ${width}`);
    }
  }
  campaignActive = false;
  await page.goto('http://horizonst.es/planes');
  await page.getByText('La campaña de prerreserva finalizó el', { exact: false }).waitFor();
  check(await page.getByRole('link', { name: 'Consultar condiciones actuales' }).count() === 3, 'Todos los planes vencidos deben ofrecer orientación');
  check(await page.getByRole('button', { name: 'Prerreservar con 5 % de descuento' }).count() === 0, 'Campaña vencida no ofrece prerreserva');

  for (const fixtureRole of ['customer', 'distributor', 'admin']) {
    role = fixtureRole;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/dashboard`);
    const label = role === 'admin' ? 'Gestionar presupuestos' : 'Mis presupuestos';
    await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: label, exact: true }).click();
    await page.getByRole('heading', { level: 1, name: label, exact: true }).waitFor();
    check(parseUrl(page.url()).pathname === (role === 'admin' ? '/admin/quotes' : '/quotes'), `Destino incorrecto para ${role}`);
    if (role !== 'admin') { await page.goto(`${base}/admin/quotes`); await page.waitForURL('**/dashboard'); }
  }
  role = 'admin';
  await page.goto(`${base}/admin/quotes?status=submitted`);
  await page.getByText('No hay presupuestos que coincidan', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await page.getByText('Q-FIXTURE', { exact: true }).waitFor();
  check(await page.getByRole('combobox', { name: 'Estado', exact: true }).inputValue() === '', 'Limpiar filtros debe vaciar estado inicial de URL');
  delayRejected = true;
  await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('rejected');
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent.includes('Filtros aplicados: Estado: Rechazado'));
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await page.getByText('Q-FIXTURE', { exact: true }).waitFor();
  check(Boolean(delayedFilter), 'La petición antigua debe estar pendiente');
  delayedFilter();
  await page.waitForTimeout(150);
  check(await page.getByText('Q-FIXTURE', { exact: true }).isVisible(), 'Respuesta antigua no debe reemplazar lista recuperada');
  await page.goto(`${base}/register`);
  for (const name of ['Nombre completo', 'Email', 'Teléfono (opcional)', 'Contraseña']) check(await page.getByLabel(name, { exact: true }).count() === 1, `Etiqueta inexistente: ${name}`);
  await page.getByLabel('Nombre completo').focus(); await page.keyboard.press('Tab');
  check(await page.getByLabel('Email', { exact: true }).evaluate((e) => e === document.activeElement), 'Orden de teclado de registro');

  for (const cartRole of ['customer', 'distributor']) {
  role = cartRole;
  await page.goto(`${base}/catalog`);
  await page.getByRole('button', { name: 'Añadir hardware', exact: true }).first().click();
  await page.getByText('Artículo añadido al carrito.', { exact: false }).waitFor();
  await page.goto(`${base}/cart`);
  await page.getByText('PACK Starter', { exact: true }).waitFor();
  check(await page.locator('.totals .grand').textContent().then((text) => /3.?932,50/.test(text)), 'Total inicial IVA incorrecto');
  await page.getByRole('spinbutton').fill('2');
  await page.waitForFunction(() => /7.?865,00/.test(document.querySelector('.totals .grand').textContent));
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.getByText('Tu carrito está vacío.').waitFor();
  }
  role = 'admin';
  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const pathname of ['/register', '/catalog', '/cart', '/admin', '/admin/quotes']) {
      await page.goto(`${base}${pathname}`);
      await page.getByRole('heading', { level: 1 }).waitFor();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow Store ${pathname} ${width}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/admin/quotes`);
  await page.getByRole('heading', { name: 'Gestionar presupuestos', level: 1 }).waitFor();
  check((await page.getByRole('heading', { level: 1 }).boundingBox()).y < 420, 'Título administrativo demasiado abajo');
  const menu = page.getByRole('button', { name: 'Secciones · Gestionar presupuestos' });
  await menu.focus(); await page.keyboard.press('Enter');
  check(await menu.getAttribute('aria-expanded') === 'true', 'Menú administrativo no abre con teclado');
  await page.getByRole('navigation', { name: 'Administración' }).getByRole('link', { name: 'Resumen comercial' }).click();
  await page.waitForURL('**/admin');
  await page.screenshot({ path: 'output/playwright/auditoria-admin-390.png' });
  check(await page.title() === 'Resumen comercial | HorizonST Store', 'Título dinámico incorrecto');
  check(errors.length === 0, `Errores de navegador: ${errors.join('; ')}`);
  check(!apiCalls.some((call) => /cart\/submit|\/accept|\/register|\/orders.*POST/.test(call)), 'No se deben enviar solicitudes o pedidos');
  return { result: 'passed', viewportWidths: [390, 768, 1024, 1280, 1440], roles: ['customer', 'distributor', 'admin'], cartRoles: ['customer', 'distributor'], guideContrast: contrast, simulatedLeadRequests: leadRequests, apiCalls: apiCalls.length, browserErrors: errors.length };
})
