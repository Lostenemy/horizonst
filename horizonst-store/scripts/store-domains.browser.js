(async (page) => {
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  const local = 'http://127.0.0.1:4173';
  const hosts = ['horizonst.es', 'www.horizonst.es', 'horizonst.com.es', 'www.horizonst.com.es', 'tienda.horizonst.es', 'tienda.horizonst.com.es'];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  // Todos los destinos virtuales se sirven desde loopback; nunca desde Internet.
  await page.route('**/*', async (route) => {
    const match = /^https?:\/\/([^/:]+)(?::\d+)?([^?]*)(\?.*)?$/.exec(route.request().url());
    const host = match?.[1]; const path = match?.[2] || '/'; const search = match?.[3] || '';
    if (![...hosts, '127.0.0.1', 'horizonst.es.evil.test'].includes(host)) return route.abort();
    const reply = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    if (path.startsWith('/api/')) {
      if (path === '/api/catalog/saas-plans') return reply({ saasPlans: ['starter', 'professional', 'enterprise'].map((code) => ({ code, id: code, name: code, annual_price_cents: 60000, tax_rate: 21, is_active: true, is_enterprise: false, max_tags: 10, max_gateways: 5 })) });
      if (path === '/api/public/prereservation/campaign') return reply({ active: true, endAt: '2027-01-01T22:59:59.999Z', codes: ['starter', 'professional', 'enterprise'] });
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    }
    const response = await route.fetch({ url: `${local}${path}${search}` });
    return route.fulfill({ response });
  });
  let checkedPages = 0;
  for (const host of hosts) {
    const staging = host.endsWith('.com.es');
    const store = `https://${staging ? 'tienda.horizonst.com.es' : 'tienda.horizonst.es'}`;
    const marketing = `https://${staging ? 'horizonst.com.es' : 'horizonst.es'}`;
    if (!host.startsWith('tienda.')) {
      for (const path of ['/', '/planes', '/info-faqs']) {
        await page.goto(`http://${host}${path}`);
        await page.locator('.lp-nav').waitFor();
        if (path === '/planes') await page.getByRole('button', { name: 'Prerreservar con 5 % de descuento' }).first().waitFor();
        check((await page.title()).endsWith(' | HorizonST'), `${host}${path} must show marketing`);
        const links = await page.getByRole('link', { name: 'Tienda B2B', exact: true }).evaluateAll((elements) => elements.map((e) => e.getAttribute('href')));
        check(links.length > 0 && links.every((href) => href === store), `Incorrect shop destinations ${host}${path}`);
        const titles = { '/': 'Supervisión en cámaras congeladoras', '/planes': 'Planes', '/info-faqs': 'Cómo funciona' };
        check(await page.title() === `${titles[path]} | HorizonST`, `Incorrect page ${host}${path}`);
        checkedPages++;
      }
      await page.getByRole('link', { name: 'Tienda B2B', exact: true }).first().click();
      check(page.url() === `${store}/`, `Shop click crossed environments: ${host}`);
    } else await page.goto(`http://${host}/`);
    await page.locator('.topbar').waitFor();
    check(await page.title() === 'Tienda B2B | HorizonST Store', `Shop classified as marketing: ${host}`);
    const backlink = page.getByRole('link', { name: 'Web HorizonST', exact: true });
    check(await backlink.getAttribute('href') === marketing, `Incorrect marketing backlink: ${host}`);
    await backlink.click();
    await page.locator('.lp-nav').waitFor();
    check(page.url() === `${marketing}/`, `Backlink crossed environments: ${host}`);
    checkedPages++;
  }
  await page.goto('http://horizonst.es.evil.test/');
  await page.locator('.topbar').waitFor();
  check(await page.getByRole('link', { name: 'Web HorizonST' }).getAttribute('href') === '/', 'Similar domain must not produce an authorized external destination');
  await page.goto(`${local}/`);
  await page.locator('.topbar').waitFor();
  check(await page.title() === 'Tienda B2B | HorizonST Store', 'Local Store journey must remain available');
  check(errors.length === 0, errors.join('; '));
  return { result: 'passed', hosts, checkedPages, unknownHostRejected: true, localStorePreserved: true, browserErrors: errors.length };
})
