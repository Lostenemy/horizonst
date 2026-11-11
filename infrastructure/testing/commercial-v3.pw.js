// Offline Playwright CLI callback: only loopback static assets; all application APIs simulated.
async page => {
  const origin = new URL(page.url());
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') throw new Error('Loopback preview required');
  const checks = [], errors = [], posts = [], images = [], consoleErrors = [];
  const check = (name, ok, detail = null) => { checks.push({ name, ok, detail }); if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); };
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const onConsole = message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), path: new URL(message.location().url || origin.origin).pathname }); };
  page.on('console', onConsole);
  const hosts = ['horizonst.es', 'www.horizonst.es', 'horizonst.com.es', 'www.horizonst.com.es', 'tienda.horizonst.es', 'tienda.horizonst.com.es'];
  let contactMode = 'error', arrived, release;
  const entered = new Promise(resolve => { arrived = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const plans = ['starter', 'professional', 'enterprise'].map((code, i) => ({ id: `fixture-${code}`, code,
    name: ['Starter', 'Professional', 'Enterprise'][i], annual_price_cents: [61500, 82500, 125000][i],
    max_tags: [10, 20, 40][i], max_gateways: [5, 10, 20][i], tax_rate: 21, is_active: true, is_enterprise: false }));
  await page.unroute('**/*');
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (!hosts.includes(url.hostname)) return route.abort();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/api/')) {
      if (req.method() === 'POST') {
        if (url.pathname !== '/api/contact') return route.abort();
        // Assertions in memory only: never record form bodies in evidence.
        const body = req.postDataJSON();
        posts.push({ path: url.pathname, purpose: body.purpose, profile: body.profile, emptyCompany: body.companyName === '' });
        if (contactMode === 'hold') { arrived(); await held; }
        if (contactMode === 'success') return json(200, { ok: true });
        return json(503, { error: 'simulated_unavailable' });
      }
      if (url.pathname === '/api/catalog/saas-plans') return json(200, { saasPlans: plans });
      if (url.pathname === '/api/public/prereservation/campaign') return json(200, { campaign: 'fixture', active: false, endAt: '2027-01-01T22:59:59.999Z', codes: plans.map(p => p.code) });
      return json(401, {});
    }
    const response = await page.request.get(origin.origin + url.pathname);
    if (url.pathname.startsWith('/images/comercial-v3/')) images.push({ path: url.pathname, type: response.headers()['content-type'], status: response.status() });
    return route.fulfill({ response });
  });
  const paths = ['/', '/planes', '/info-faqs', '/contacto', '/colaboraciones', '/colaboraciones/instaladores', '/colaboraciones/asesorias-prl', '/colaboraciones/ingenierias-frio'];
  try {
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      for (const [index, path] of paths.entries()) {
        await page.goto('https://horizonst.es' + path);
        if (path === '/planes') await page.getByRole('heading', { name: 'Compara capacidad y cuota' }).waitFor();
        await page.evaluate(async () => {
          // Trigger lazy images without fabricating network events or changing app data.
          for (const img of document.images) { img.scrollIntoView(); await img.decode().catch(() => {}); }
          window.scrollTo(0, 0); await document.fonts.ready;
        });
        const state = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
          heading: document.querySelectorAll('h1').length, current: document.querySelectorAll('.lp-nav [aria-current="page"]').length,
          broken: [...document.images].filter(img => !img.naturalWidth).map(img => img.getAttribute('src')),
          description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
          asset: [...document.images].filter(img => img.currentSrc.includes('comercial-v3')).map(img => img.currentSrc) }));
        check(`${path}-${width}`, !state.overflow && state.heading === 1 && state.current === 1 && !state.broken.length && !!state.description, state);
        const invalidLinks = await page.locator('a[href]').evaluateAll(anchors => anchors.map(a => new URL(a.href)).filter(url =>
          url.origin === location.origin ? !['/', '/planes', '/info-faqs', '/contacto', '/colaboraciones', '/colaboraciones/instaladores', '/colaboraciones/asesorias-prl', '/colaboraciones/ingenierias-frio', '/privacidad', '/aviso-legal'].includes(url.pathname)
          : !['https://tienda.horizonst.es', 'https://tienda.horizonst.com.es', 'https://www.boe.es'].includes(url.origin)).map(url => url.pathname));
        check(`${path}-${width}-links`, invalidLinks.length === 0, invalidLinks);
        if (path !== '/planes') check(`${path}-${width}-responsive`, state.asset.every(src => src.includes(width <= 640 ? '-movil.' : '-escritorio.')), state.asset);
        if (width !== 320) await page.screenshot({ path: `output/playwright/commercial-v3-20261103/final/${width}-${index}.png`, fullPage: true });
      }
    }
    for (const host of hosts.slice(0, 4)) {
      await page.goto(`https://${host}/colaboraciones/asesorias-prl`);
      check(host + '-store', await page.locator('.lp-nav > .btn').getAttribute('href') === `https://tienda.${host.endsWith('.com.es') ? 'horizonst.com.es' : 'horizonst.es'}`);
      check(host + '-privacy', await page.locator('form a').first().getAttribute('href') === '/privacidad');
    }
    for (const host of hosts.slice(4)) { await page.goto(`https://${host}/`); check(host + '-private-store-unchanged', await page.locator('.lp-nav').count() === 0); }
    await page.goto('https://horizonst.es/info-faqs#funcionamiento');
    const faq = page.locator('details').first(); await faq.locator('summary').focus(); await page.keyboard.press('Enter');
    check('faq-keyboard', await faq.getAttribute('open') !== null);
    await page.keyboard.press('Space'); check('faq-keyboard-close', await faq.getAttribute('open') === null);
    await page.goto('https://horizonst.es/contacto?motivo=presupuesto');
    check('quote-origin', await page.locator('#contact-purpose').inputValue() === 'presupuesto');
    await page.locator('#contact-purpose').selectOption('colaboracion');
    check('purpose-heading-synchronized', await page.getByRole('heading', { name: 'Cuéntanos cómo trabajáis con vuestros clientes' }).count() === 1);
    await page.locator('#contact-purpose').selectOption('presupuesto');
    await page.locator('form button').click();
    check('invalid-no-post', posts.length === 0);
    check('invalid-focus', await page.locator('#contact-name').evaluate(el => el === document.activeElement));
    await page.locator('#contact-name').fill('Persona ficticia'); await page.locator('#contact-email').fill('fixture@example.invalid');
    await page.locator('#contact-profile').selectOption('gerencia'); await page.locator('#contact-privacy').check();
    check('company-optional', !await page.locator('#contact-company').evaluate(el => el.required));
    check('privacy-not-marketing', await page.getByRole('checkbox').count() === 1);
    contactMode = 'hold'; await page.locator('form button').click(); await entered;
    check('sending-disabled', await page.locator('form button').isDisabled());
    await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    check('duplicate-suppressed', posts.length === 1);
    release(); await page.getByRole('alert').filter({ hasText: 'No hemos podido confirmar' }).waitFor();
    check('error-retains-fields', await page.locator('#contact-name').inputValue() === 'Persona ficticia');
    await page.screenshot({ path: 'output/playwright/commercial-v3-20261103/final/contact-error.png', fullPage: true });
    contactMode = 'success'; await page.locator('form button').click();
    await page.getByRole('status').filter({ hasText: 'Hemos recibido tu solicitud de presupuesto' }).waitFor();
    check('confirmed-only-after-ok', posts.length === 2 && posts[1].emptyCompany && posts[1].purpose === 'presupuesto');
    for (const profile of ['instaladores', 'asesorias-prl', 'ingenierias-frio']) {
      await page.goto('https://horizonst.es/colaboraciones/' + profile);
      check(profile + '-fixed-origin', await page.locator('#contact-profile').count() === 0);
      await page.locator('#contact-name').fill('Colaborador ficticio'); await page.locator('#contact-email').fill('collaborator@example.invalid'); await page.locator('#contact-privacy').check();
      await page.locator('form button').click(); await page.getByRole('status').filter({ hasText: 'Hemos recibido tu consulta de colaboración' }).waitFor();
      check(profile + '-delivery-context', posts.at(-1).profile === profile && posts.at(-1).purpose === 'colaboracion' && posts.at(-1).emptyCompany);
    }
    await page.goto('https://horizonst.es/colaboraciones/desconocida'); check('unknown-route', await page.getByRole('heading', { name: 'Página no encontrada' }).count() === 1);
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('https://horizonst.es/');
    await page.locator('picture source[type="image/avif"]').evaluateAll(sources => sources.forEach(source => source.remove()));
    await page.locator('.lp-hero img').evaluate(img => img.decode());
    check('webp-fallback-decodes', (await page.locator('.lp-hero img').evaluate(img => img.currentSrc)).endsWith('-movil.webp'));
    check('formats-loaded', images.some(img => img.path.endsWith('.avif') && img.type.startsWith('image/avif') && img.status === 200) && images.some(img => img.path.endsWith('.svg') && img.status === 200));
    check('no-javascript-errors', errors.length === 0, errors);
    const unexpected = consoleErrors.filter(error => !/status of (503|401)/.test(error.text) && error.path !== '/favicon.ico');
    check('no-unexpected-console-errors', unexpected.length === 0, unexpected);
    return { checks, posts, images, errors, consoleErrors, summary: { passed: checks.length, failed: 0, transport: 'all APIs intercepted; no real SMTP or submissions' } };
  } finally { page.off('pageerror', onError); page.off('console', onConsole); }
}
