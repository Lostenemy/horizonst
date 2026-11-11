// Read-only local preview. All displayed domains are intercepted; no real API or submission.
async page => {
  const origin = new URL(page.url());
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') throw new Error('Start on loopback preview');
  const moved = ['¿Cómo seguís hoy los tiempos dentro de la cámara?', 'Del control diario a los registros que necesitas', 'Un dispositivo personal, un control automático', 'Dedica menos esfuerzo a reunir la información'];
  const checks = [], measurements = [], errors = [];
  let attemptedWrites = 0;
  const check = (name, ok) => { checks.push({ name, ok }); if (!ok) throw new Error(name); };
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  await page.unroute('**/*');
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['horizonst.es', 'horizonst.com.es'].includes(url.hostname)) return route.abort();
    if (request.method() !== 'GET') { attemptedWrites++; return route.abort(); }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ response: await page.request.get(origin.origin + url.pathname) });
  });
  try {
    await page.goto('https://horizonst.es/');
    const original = await page.getByRole('heading', { name: moved[0], exact: true }).count() === 1;
    const phase = original ? 'before' : 'after';
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      for (const [path, label] of [['/', 'inicio'], ['/info-faqs', 'funcionamiento']]) {
        await page.goto('https://horizonst.es' + path);
        await page.evaluate(async () => {
          for (const image of document.images) { image.scrollIntoView(); await image.decode().catch(() => {}); }
          await document.fonts.ready; window.scrollTo(0, 0);
        });
        const state = await page.evaluate(async () => ({
          height: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth,
          headings: [...document.querySelectorAll('h2')].map(el => el.textContent),
          broken: [...document.images].filter(img => !img.naturalWidth).length,
          diagram: document.querySelectorAll('img[src$="03-funcionamiento-escritorio.svg"]').length,
          anchors: document.querySelectorAll('#funcionamiento').length,
          hero: document.querySelector('.lp-hero')?.innerHTML ?? '',
          images: [...document.images].map(img => img.getAttribute('src'))
        }));
        measurements.push({ phase, width, path, ...state });
        check(`${label}-${width}-layout`, !state.overflow && state.broken === 0 && state.diagram === 1 && state.anchors === 1);
        if (!original) {
          for (const title of moved) check(`${label}-${width}-${title}`, state.headings.filter(value => value === title).length === (path === '/' ? 0 : 1));
          if (path === '/') {
            check(`home-${width}-retained`, state.headings.includes('Caso de éxito') && state.headings.includes('¿Acompañas a empresas que trabajan con cámaras congeladoras?') && state.headings.includes('Veamos qué necesita tu instalación'));
            check(`home-${width}-three-images`, state.images.length === 3);
          } else check(`info-${width}-steps-once`, state.headings.filter(value => value === 'De la presencia del trabajador al seguimiento preventivo').length === 0);
        }
        await page.screenshot({ path: `output/playwright/home-shortening-20261103/${phase}-${label}-${width}.png`, fullPage: true });
      }
    }
    await page.goto('https://horizonst.es/'); await page.getByRole('link', { name: 'Ver cómo funciona', exact: true }).click();
    await page.waitForURL('**/info-faqs#funcionamiento'); await page.locator('#funcionamiento').waitFor();
    check('hero-process-link', page.url().endsWith('/info-faqs#funcionamiento') && await page.locator('#funcionamiento').count() === 1);
    await page.getByRole('heading', { name: 'Preguntas frecuentes', exact: true }).scrollIntoViewIfNeeded();
    const faq = page.locator('details').first(); await faq.locator('summary').focus(); await page.keyboard.press('Enter');
    check('faq-keyboard', await faq.getAttribute('open') !== null);
    check('no-writes', attemptedWrites === 0); check('no-javascript-errors', errors.length === 0);
    return { phase, measurements, checks, errors, attemptedWrites, passed: checks.length, failed: 0 };
  } finally { page.off('pageerror', onError); }
}
