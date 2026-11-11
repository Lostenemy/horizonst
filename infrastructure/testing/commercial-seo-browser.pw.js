// The initial loopback URL must be the isolated Store server, never a shared service.
async page => {
  const origin = new URL(page.url());
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') throw new Error('Loopback required');
  const errors = []; let writes = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydrat|#418|#423/i.test(message.text())) errors.push(message.text()); });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET') { writes++; return route.abort(); }
    if (!['horizonst.es', 'horizonst.com.es'].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    const headers = { host: url.hostname }; if (request.headers().range) headers.range = request.headers().range;
    return route.fulfill({ response: await page.request.get(origin.origin + url.pathname + url.search, { headers }) });
  });
  const paths = ['/', '/planes', '/info-faqs', '/contacto', '/colaboraciones', '/colaboraciones/instaladores', '/colaboraciones/asesorias-prl', '/colaboraciones/ingenierias-frio', '/aviso-legal', '/privacidad'];
  const checks = [];
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const route of paths) {
      const response = await page.goto('https://horizonst.es' + route); const original = await response.text();
      if (response.status() !== 200 || !original.includes('data-prerendered="true"')) throw new Error('No initial HTML: ' + route);
      const originalTitle = original.match(/<title>([^<]+)<\/title>/)?.[1];
      const originalContent = await page.evaluate(html => { const doc = new DOMParser().parseFromString(html, 'text/html'); return { h1: doc.querySelector('h1')?.textContent, description: doc.querySelector('meta[name="description"]')?.getAttribute('content') }; }, original);
      await page.waitForLoadState('networkidle');
      await page.evaluate(async () => { for (const img of document.images) { img.scrollIntoView(); await img.decode(); } window.scrollTo(0, 0); });
      const state = await page.evaluate(() => ({ title: document.title, h1: document.querySelector('h1')?.textContent, description: document.querySelector('meta[name="description"]')?.getAttribute('content'), count: document.querySelectorAll('h1').length, overflow: document.documentElement.scrollWidth > innerWidth, canonical: document.querySelector('link[rel=canonical]')?.getAttribute('href') }));
      if (state.count !== 1 || state.title !== originalTitle || state.h1 !== originalContent.h1 || state.description !== originalContent.description || state.overflow || state.canonical !== 'https://horizonst.es' + route) throw new Error(route + ' ' + JSON.stringify(state));
      checks.push({ route, width, state });
      if (route === '/' || route === '/info-faqs') await page.screenshot({ path: `output/playwright/commercial-seo-verified-20261111/${route === '/' ? 'home' : 'info'}-${width}.png`, fullPage: true });
    }
  }
  await page.goto('https://horizonst.es/contacto?motivo=presupuesto');
  await page.waitForFunction(() => document.querySelector('#contact-purpose')?.value === 'presupuesto');
  await page.locator('#contact-purpose').selectOption('instalacion');
  if (await page.locator('#contact-purpose').inputValue() !== 'instalacion') throw new Error('Contact selection failed');
  await page.goto('https://horizonst.es/planes?prerreserva=starter');
  if (await page.getByRole('dialog').count() !== 1) throw new Error('Prereservation link lost its modal');
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await page.goto('https://horizonst.es/info-faqs');
  await page.getByRole('button', { name: 'Presencia y tiempos' }).click();
  if (await page.getByRole('button', { name: 'Presencia y tiempos' }).getAttribute('aria-pressed') !== 'true') throw new Error('Selector failed');
  await page.getByRole('button', { name: 'Ampliar imagen' }).click();
  if (await page.locator('.commercial-app-image.expanded').count() !== 1) throw new Error('Image enlargement failed');
  await page.goto('https://horizonst.es/');
  if (!await page.locator('video').getAttribute('controls') && await page.locator('video').evaluate(v => !v.controls)) throw new Error('Video controls missing');
  await page.locator('video').evaluate(v => { v.muted = true; return v.play(); });
  await page.locator('video').evaluate(v => v.pause());
  await page.getByRole('link', { name: 'Ver cómo funciona', exact: true }).click();
  await page.waitForURL('**/info-faqs#funcionamiento');
  await page.goto('https://horizonst.es/'); await page.getByRole('link', { name: 'Consultar normativa y posibles sanciones' }).click();
  await page.waitForURL('**/info-faqs#normativa');
  await page.goto('https://horizonst.com.es/info-faqs'); await page.waitForLoadState('networkidle');
  if (await page.locator('meta[name="robots"]').getAttribute('content') !== 'noindex, nofollow') throw new Error('Staging indexing not disabled');
  if (await page.locator('.lp-nav > .btn').getAttribute('href') !== 'https://tienda.horizonst.com.es') throw new Error('Staging store link changed');
  if (errors.length || writes) throw new Error(JSON.stringify({ errors, writes }));
  return { checks, errors, writes, scope: 'isolated host and backend, no submissions' };
}
