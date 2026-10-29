// Playwright CLI callback. Pass the loopback origin of commercial-preview.cjs.
// ALL browser requests intercepted; never contacts the hostnames shown in the bar.
async (page, previewOrigin = new URL(page.url()).origin) => {
  const origin = new URL(previewOrigin);
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') throw new Error('Loopback preview required');
  const rows = [], posts = [], errors = [];
  const check = (name, ok, detail = null) => { rows.push({ name, ok, detail }); if (!ok) throw new Error(name); };
  let mode = 'normal', releaseContact;
  let arrivedContact;
  const contactArrival = new Promise(resolve => { arrivedContact = resolve; });
  const holdContact = new Promise(resolve => { releaseContact = resolve; });
  let releaseCatalog;
  const holdCatalog = new Promise(resolve => { releaseCatalog = resolve; });
  const plans = ['starter', 'professional', 'enterprise'].map((code, i) => ({
    id: `fixture-${code}`, code, name: ['Starter', 'Professional', 'Enterprise'][i], description: null,
    annual_price_cents: [61500, 82500, 125000][i], tax_rate: 21,
    max_tags: [10, 20, 40][i], max_gateways: [5, 10, 20][i], is_active: true, is_enterprise: false
  }));
  const campaign = { campaign: 'fixture', active: true, endAt: '2027-01-01T22:59:59.999Z', codes: plans.map(p => p.code) };
  const onPageError = error => errors.push(error.message);
  page.on('pageerror', onPageError);
  await page.unroute('**/*');
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['horizonst.es', 'www.horizonst.es', 'horizonst.com.es', 'www.horizonst.com.es', 'tienda.horizonst.es', 'tienda.horizonst.com.es'].includes(url.hostname)) return route.abort();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/api/')) {
      if (request.method() === 'POST') {
        posts.push(url.pathname); // no body, personal data, tokens or credentials recorded
        if (url.pathname === '/api/contact' && mode === 'holdContact') { arrivedContact(); await holdContact; }
        if (url.pathname === '/api/contact' && mode === 'contactSuccess') return json(200, { ok: true });
        return json(503, { error: 'simulated_unavailable' });
      }
      if (mode === 'catalogError') return json(503, {});
      if (mode === 'holdCatalog') await holdCatalog;
      if (url.pathname === '/api/catalog/saas-plans') return json(200, { saasPlans: mode === 'catalogEmpty' ? [] : plans });
      if (url.pathname === '/api/public/prereservation/campaign') return json(200, campaign);
      return json(401, {});
    }
    const response = await page.request.get(origin.origin + url.pathname);
    return route.fulfill({ response });
  });
  const screenshot = async (name, fullPage = true) => {
    if (fullPage) await page.evaluate(() => new Promise(resolve => {
      window.scrollTo(0, 0); requestAnimationFrame(() => resolve());
    }));
    return page.screenshot({ path: `output/playwright/commercial-review-20261029/${name}.png`, fullPage });
  };
  try {
    for (const width of [320, 390, 768, 1366, 1440]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      for (const [path, name] of [['/', 'inicio'], ['/planes', 'planes'], ['/info-faqs', 'funcionamiento'], ['/contacto', 'contacto']]) {
        await page.goto('https://horizonst.es' + path);
        if (path === '/planes') await page.getByRole('heading', { name: 'Compara capacidad y cuota' }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          current: [...document.querySelectorAll('.lp-nav [aria-current="page"]')].map(a => a.getAttribute('href')),
          brokenImages: [...document.images].filter(i => i.complete && !i.naturalWidth).length,
          horizontalElements: [...document.querySelectorAll('main *')].filter(el => {
            const r = el.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1);
          }).map(el => el.className).slice(0, 5)
        }));
        check(`${name}-${width}`, !metrics.overflow && metrics.current.length === 1 && metrics.current[0] === path && !metrics.brokenImages, metrics);
        if (width === 390 || width === 1440) await screenshot(`${width === 390 ? 'mobile' : 'desktop'}-${name}`);
      }
    }
    for (const host of ['horizonst.es', 'www.horizonst.es', 'horizonst.com.es', 'www.horizonst.com.es']) {
      for (const path of ['/', '/planes', '/info-faqs', '/contacto']) {
        await page.goto(`https://${host}${path}`);
        check(`${host}${path}-store-env`, await page.locator('.lp-nav > .btn').getAttribute('href') === `https://tienda.${host.endsWith('.com.es') ? 'horizonst.com.es' : 'horizonst.es'}`);
        check(`${host}${path}-local-contact`, await page.locator('.lp-nav-links a').last().getAttribute('href') === '/contacto');
      }
    }
    for (const host of ['tienda.horizonst.es', 'tienda.horizonst.com.es']) {
      await page.goto(`https://${host}/`);
      check(`${host}-store-not-marketing`, await page.locator('.lp-nav').count() === 0);
    }
    await page.goto('https://horizonst.es/info-faqs');
    const faq = page.locator('details').first(), summary = faq.locator('summary');
    await summary.click(); check('faq-mouse-open', await faq.getAttribute('open') !== null);
    await summary.focus(); await page.keyboard.press('Enter'); check('faq-enter-close', await faq.getAttribute('open') === null);
    await page.keyboard.press('Space'); check('faq-space-open', await faq.getAttribute('open') !== null);
    await page.goto('https://horizonst.es/');
    await page.getByRole('link', { name: 'Ver cómo funciona', exact: true }).click();
    check('process-anchor', page.url().endsWith('/info-faqs#funcionamiento'));
    check('process-anchor-visible', await page.locator('#funcionamiento').evaluate(el => el.getBoundingClientRect().top >= 0));
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('https://horizonst.es/planes');
      const trigger = page.getByRole('button', { name: 'Prerreservar con 5 % de descuento' }).first();
      await trigger.click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor();
      const input = dialog.getByRole('textbox', { name: 'Email profesional' });
      check(`modal-${width}-initial-focus`, await input.evaluate(el => document.activeElement === el));
      await input.fill('fixture@example.invalid');
      const privacy = dialog.getByRole('checkbox'); await privacy.check();
      check(`modal-${width}-focus-stable`, await privacy.evaluate(el => document.activeElement === el));
      await dialog.getByRole('button', { name: 'Ver oferta', exact: true }).focus(); await page.keyboard.press('Tab');
      check(`modal-${width}-trap`, await dialog.getByRole('button', { name: 'Cerrar', exact: true }).evaluate(el => document.activeElement === el));
      const colors = await dialog.getByRole('button', { name: 'Cerrar', exact: true }).evaluate(el => {
        const s = getComputedStyle(el); return { color: s.color, background: s.backgroundColor, width: el.offsetWidth, height: el.offsetHeight };
      });
      check(`modal-${width}-contrast`, colors.color === 'rgb(255, 255, 255)' && colors.background === 'rgb(8, 35, 63)' && colors.width >= 44 && colors.height >= 44, colors);
      await screenshot(`${width === 390 ? 'mobile' : 'desktop'}-modal`, false);
      await page.keyboard.press('Escape'); check(`modal-${width}-escape`, await dialog.count() === 0);
      check(`modal-${width}-return-focus`, await trigger.evaluate(el => document.activeElement === el));
      await trigger.click(); await dialog.getByRole('button', { name: 'Ver oferta', exact: true }).click();
      check(`modal-${width}-invalid-no-post`, posts.length === 0);
      await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('https://horizonst.es/contacto');
    await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    check('contact-invalid-focus', await page.locator('#contact-name').evaluate(el => document.activeElement === el));
    check('contact-invalid-no-post', posts.length === 0);
    await screenshot('mobile-contacto-validacion');
    await page.getByLabel('Nombre', { exact: true }).fill('Prueba ficticia');
    await page.getByLabel('Correo electrónico', { exact: true }).fill('fixture@example.invalid');
    await page.getByLabel('Mensaje', { exact: true }).fill('Prueba local simulada: dos cámaras de ejemplo.');
    await page.getByRole('checkbox').check(); mode = 'holdContact';
    await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    let arrivalTimer;
    try { await Promise.race([contactArrival, new Promise((_, reject) => { arrivalTimer = setTimeout(() => reject(new Error('Local route not reached')), 5000); })]); }
    finally { clearTimeout(arrivalTimer); }
    check('contact-loading-disabled', await page.getByRole('button', { name: 'Enviando...', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Enviando...', exact: true }).evaluate(el => { el.click(); el.click(); });
    check('contact-no-duplicate', posts.length === 1);
    releaseContact();
    await page.getByRole('alert').filter({ hasText: 'No se ha podido confirmar' }).waitFor();
    check('contact-error-preserves-data', await page.locator('#contact-name').inputValue() === 'Prueba ficticia' && await page.locator('#contact-privacy').isChecked());
    await screenshot('mobile-contacto-error');
    mode = 'contactSuccess'; await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Mensaje enviado.' }).waitFor();
    check('contact-success-simulated', await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).isDisabled());
    await page.goto('https://horizonst.es/');
    const beforeGuide = posts.length;
    await page.getByRole('button', { name: 'Recibir la guía por email', exact: true }).click();
    check('guide-invalid-no-post', posts.length === beforeGuide && await page.locator('#guia-solicitud input[type="email"]').evaluate(el => el.validity.valueMissing));
    mode = 'holdCatalog'; await page.goto('https://horizonst.es/planes');
    await page.getByRole('status').filter({ hasText: 'Cargando precios' }).waitFor(); check('plans-loading', true);
    releaseCatalog(); await page.getByRole('heading', { name: 'Compara capacidad y cuota' }).waitFor();
    mode = 'catalogError'; await page.goto('https://horizonst.es/planes');
    await page.getByRole('alert').filter({ hasText: 'No se pudieron cargar' }).waitFor(); check('plans-error', true);
    mode = 'catalogEmpty'; await page.reload();
    await page.getByText('No hay planes disponibles en este momento.', { exact: false }).waitFor(); check('plans-empty', true);
    mode = 'normal'; await page.reload();
    await page.getByRole('heading', { name: 'Compara capacidad y cuota' }).waitFor();
    check('plans-recovery', true);
    await page.goto('https://horizonst.com.es/contacto');
    await page.getByRole('link', { name: 'política de privacidad', exact: true }).click();
    check('privacy-remains-staging', page.url() === 'https://horizonst.com.es/privacidad');
    check('no-runtime-errors', errors.length === 0, errors);
    check('no-guide-or-prereservation-submissions', posts.every(p => p === '/api/contact'), posts);
    return { fixturePrices: true, network: 'all browser requests intercepted; static data via loopback only', checks: rows.length, results: rows, simulatedPosts: posts };
  } finally {
    releaseContact();
    releaseCatalog();
    page.off('pageerror', onPageError);
    // Do not close any browser/tab; leave local review available.
  }
}
