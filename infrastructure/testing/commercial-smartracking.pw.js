// Local-only functional preview. Domain names are simulated and every request is intercepted.
async page => {
  const origin = new URL(page.url());
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') throw new Error('Loopback preview required');
  const checks = [], measurements = [], errors = [], failedResources = [];
  let attemptedWrites = 0, failureMode = 'none';
  const check = (name, ok, detail = null) => { checks.push({ name, ok, detail }); if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); };
  const onError = error => errors.push(error.message); page.on('pageerror', onError);
  await page.unroute('**/*');
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['horizonst.es', 'www.horizonst.es', 'horizonst.com.es', 'www.horizonst.com.es'].includes(url.hostname)) return route.abort();
    if (request.method() !== 'GET') { attemptedWrites++; return route.abort(); }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' });
    if (url.pathname.includes('07-contacto-instalacion') && (failureMode === 'all' || (failureMode === 'avif' && url.pathname.endsWith('.avif')))) {
      failedResources.push({ mode: failureMode, path: url.pathname }); return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ response: await page.request.get(origin.origin + url.pathname) });
  });
  const loadImages = () => page.evaluate(async () => {
    for (const image of document.querySelectorAll('img')) {
      image.scrollIntoView(); await image.decode().catch(() => {});
    }
    await document.fonts.ready; window.scrollTo(0, 0);
  });
  try {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      for (const [path, label] of [['/', 'inicio'], ['/info-faqs', 'funcionamiento']]) {
        await page.goto('https://horizonst.com.es' + path); await loadImages();
        const state = await page.evaluate(() => ({
          height: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth,
          h1: document.querySelector('h1')?.textContent, smartracking: (document.body.innerText.match(/Smartracking/g) || []).length,
          broken: [...document.images].filter(img => !img.naturalWidth).map(img => img.getAttribute('src')),
          images: [...document.images].map(img => ({ src: new URL(img.currentSrc || img.src, location.href).pathname, width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height })),
          headings: [...document.querySelectorAll('h2')].map(el => el.textContent),
          advantages: [...document.querySelectorAll('.commercial-home-advantages li')].map(el => ({ text: el.textContent, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, display: getComputedStyle(el).display })),
          listStyle: document.querySelector('.commercial-home-advantages') ? getComputedStyle(document.querySelector('.commercial-home-advantages')).listStyleType : null,
          steps: document.querySelectorAll('.commercial-process > li').length, faq: document.querySelectorAll('details').length,
          diagrams: document.querySelectorAll('.commercial-operation').length
        }));
        measurements.push({ path, width, ...state });
        check(`${label}-${width}-layout`, !state.overflow && !state.broken.length && state.images.every(image => image.width > 0 && image.height > 0), state);
        check(`${label}-${width}-smartracking-body-name`, state.smartracking === (path === '/' ? 2 : 5));
        check(`${label}-${width}-diagram`, state.diagrams === 1);
        if (path === '/') {
          check(`${width}-three-vertical-benefits`, state.advantages.length === 3 && state.listStyle === 'decimal' && state.advantages.every((item, index) => item.display === 'list-item' && (index === 0 || item.top >= state.advantages[index-1].bottom)), state.advantages);
          check(`${width}-headline-integrates-brand`, state.h1 === 'Horizon Smartracking controla automáticamente la permanencia y los descansos en tus cámaras congeladoras.' && await page.locator('.commercial-brand-line').count() === 0);
          const buttons = await page.locator('.lp-hero .actions a').evaluateAll(anchors => anchors.map(anchor => ({ text: anchor.textContent, href: anchor.getAttribute('href') })));
          check(`${width}-hero-buttons`, JSON.stringify(buttons) === JSON.stringify([{ text: 'Consultar mi instalación', href: '/contacto?motivo=instalacion' }, { text: 'Ver cómo funciona', href: '/info-faqs#funcionamiento' }]));
          check(`${width}-brief-home`, !state.headings.includes('Del control diario a los registros que necesitas') && state.headings.includes('Caso de éxito'));
        } else {
          check(`${width}-four-steps-seven-faq`, state.steps === 4 && state.faq === 7);
          check(`${width}-three-distinct-visuals`, state.images.length === 3 && state.images.some(image => image.src.includes('03-funcionamiento-compacto')) && state.images.some(image => image.src.includes('07-contacto-instalacion')) && state.images.some(image => image.src.includes('panel-publico/resumen.png')));
          const notices = await page.locator('.commercial-notices article').allTextContents();
          check(`${width}-notice-sos-separation`, notices.length === 2 && notices[0].includes('vibra y pita') && !notices[0].includes('supervisor') && notices[1].includes('pulsa SOS') && !notices[1].includes('vibra y pita'));
          check(`${width}-no-duplicate-blocks`, !state.headings.includes('¿Cómo seguís hoy los tiempos dentro de la cámara?') && !state.headings.includes('Dedica menos esfuerzo a reunir la información'));
        }
        if (width === 390 || width === 1440) await page.screenshot({ path: `output/playwright/legal-panel-v2-20261105/local-${label}-${width}.png`, fullPage: true });
      }
      await page.goto('https://horizonst.com.es/'); await page.getByRole('link', { name: 'Ver cómo funciona', exact: true }).click();
      await page.waitForURL('**/info-faqs#funcionamiento'); await page.locator('#info-process-title').waitFor(); await page.evaluate(() => document.fonts.ready);
      const position = await page.evaluate(() => ({ navBottom: document.querySelector('.lp-nav').getBoundingClientRect().bottom, titleTop: document.querySelector('#info-process-title').getBoundingClientRect().top }));
      check(`${width}-anchor-not-covered`, position.titleTop >= position.navBottom, position);
    }
    const faq = page.locator('details').first(); await faq.locator('summary').focus(); await page.keyboard.press('Enter');
    check('faq-keyboard', await faq.getAttribute('open') !== null);
    await page.setViewportSize({ width: 390, height: 844 });
    const presence = page.getByRole('button', { name: 'Presencia y tiempos' }); await presence.focus(); await page.keyboard.press('Enter');
    check('selector-keyboard', await presence.getAttribute('aria-pressed') === 'true' && (await page.locator('.commercial-app-preview img').getAttribute('src')).endsWith('/presencia.png'));
    check('six-hour-reference', (await page.locator('.commercial-app-preview figcaption').textContent()).includes('no generan bloqueos ni alarmas'));
    const expand = page.getByRole('button', { name: 'Ampliar imagen' }); await expand.focus(); await page.keyboard.press('Enter');
    check('expand-keyboard', await page.getByRole('button', { name: 'Reducir imagen' }).getAttribute('aria-pressed') === 'true' && await page.locator('.commercial-app-image.expanded').getAttribute('tabindex') === '0');
    const scrollBox = page.locator('.commercial-app-image.expanded'); await scrollBox.focus(); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.commercial-app-image.expanded')?.scrollLeft > 0);
    check('expanded-mobile-scroll', await scrollBox.evaluate(el => el.scrollWidth > el.clientWidth && el.scrollLeft > 0));
    for (const name of ['Alarmas', 'Informes', 'Resumen']) {
      const button = page.getByRole('button', { name, exact: true }); await button.focus(); await page.keyboard.press('Enter');
      await page.locator('.commercial-app-preview img').evaluate(img => img.decode());
      check(`image-loaded-${name}`, await button.getAttribute('aria-pressed') === 'true' && await page.locator('.commercial-app-preview img').evaluate(img => img.naturalWidth > 0));
    }
    const legal = await page.locator('#normativa a').evaluateAll(as => as.map(a => a.href));
    check('legal-source-links', legal.length === 7 && legal.every(link => link.startsWith('https://www.boe.es/buscar/act.php?id=')), legal);
    for (const host of ['horizonst.es', 'www.horizonst.es', 'horizonst.com.es', 'www.horizonst.com.es']) {
      await page.goto('https://' + host + '/info-faqs');
      check(`${host}-store-environment`, await page.locator('.lp-nav > .btn').getAttribute('href') === `https://tienda.${host.endsWith('.com.es') ? 'horizonst.com.es' : 'horizonst.es'}`);
    }
    await page.goto('https://horizonst.com.es/contacto'); check('company-remains-optional', !await page.locator('#contact-company').evaluate(el => el.required));
    await page.setViewportSize({ width: 390, height: 844 }); await loadImages(); failureMode = 'avif';
    await page.goto('https://horizonst.com.es/info-faqs'); await page.locator('.commercial-installation').scrollIntoViewIfNeeded();
    const installationImage = page.locator('.commercial-installation img');
    await page.waitForFunction(() => { const image = document.querySelector('.commercial-installation img'); return image && image.complete && image.naturalWidth > 0 && image.currentSrc.endsWith('-movil.webp'); });
    check('failed-avif-recovers-webp', (await installationImage.evaluate(img => img.currentSrc)).endsWith('-movil.webp'));
    failureMode = 'all'; await page.goto('https://horizonst.com.es/info-faqs'); await page.locator('.commercial-installation').scrollIntoViewIfNeeded();
    const unavailable = page.locator('.commercial-installation .commercial-image-unavailable'); await unavailable.waitFor();
    check('both-formats-failed-no-empty-hole', await unavailable.isVisible() && await page.locator('.commercial-installation img').count() === 0);
    check('bounded-image-recovery', failedResources.filter(resource => resource.mode === 'all').length === 2, failedResources);
    await page.screenshot({ path: 'output/playwright/legal-panel-v2-20261105/local-image-unavailable.png', fullPage: true });
    check('no-writes', attemptedWrites === 0); check('no-javascript-errors', errors.length === 0, errors);
    failureMode = 'none'; await page.goto('https://horizonst.com.es/');
    return { passed: checks.length, failed: 0, checks, measurements, errors, attemptedWrites, failedResources, scope: 'local intercepted hosts, simulated failures, no real API' };
  } finally { page.off('pageerror', onError); }
}
