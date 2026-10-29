// Playwright CLI callback; start on the read-only loopback preview.
async (page) => {
  const origin = new URL(page.url());
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') throw new Error('Loopback preview required');
  const checks = [], measures = [], requests = { catalog: 0, posts: 0 };
  let mode = 'normal', campaignActive = true, revision = 0;
  const check = (name, ok, detail = null) => { checks.push({ name, ok, detail }); if (!ok) throw new Error(name); };
  const fixturePlans = () => ['starter', 'professional', 'enterprise'].map((code, i) => ({
    id: `fixture-${code}`, code, name: ['Starter', 'Professional', 'Enterprise'][i], description: 'No verified extra features',
    annual_price_cents: [61500, 82500, 125000][i] + revision,
    tax_rate: 21, max_tags: [10, 20, 40][i], max_gateways: [5, 10, 20][i], is_active: true, is_enterprise: false
  }));
  await page.unroute('**/*');
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (!['horizonst.es', 'horizonst.com.es'].includes(url.hostname)) return route.abort();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/api/')) {
      if (req.method() !== 'GET') { requests.posts++; return json(503, {}); }
      if (url.pathname === '/api/catalog/saas-plans') {
        requests.catalog++;
        if (mode === 'error') return json(503, {});
        const plans = fixturePlans();
        return json(200, { saasPlans: mode === 'empty' ? [] : mode === 'partial' ? [plans[0], { ...plans[2], annual_price_cents: null, max_tags: null, max_gateways: null }] : plans });
      }
      return json(200, { campaign: 'fixture', active: campaignActive, endAt: '2027-01-01T22:59:59.999Z', codes: ['starter', 'professional', 'enterprise'] });
    }
    const response = await page.request.get(origin.origin + url.pathname);
    return route.fulfill({ response });
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.goto('https://horizonst.es/planes');
    await page.getByRole('heading', { name: 'Compara capacidad y cuota' }).waitFor();
    const measurement = await page.evaluate(() => ({
      width: innerWidth, height: innerHeight, pageHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth, oldCards: document.querySelectorAll('.lp-plans-page > .lp-grid .lp-plan-card').length,
      compactOptions: document.querySelectorAll('.lp-comparison-item .lp-plan-action').length
    }));
    const stage = measurement.compactOptions ? 'after' : 'before';
    check(`${stage}-${width}-no-overflow`, measurement.scrollWidth <= width);
    measures.push({ stage, ...measurement });
    await page.screenshot({ path: `output/playwright/plans-polish-20261029/${stage === 'after' ? 'after-final' : stage}-${width}.png`, fullPage: true });
  }
  const after = measures[0].stage === 'after';
  if (after) {
    check('PL-001-single-presentation', await page.locator('.lp-comparison-item').count() === 3 && await page.locator('.lp-plan-card').count() === 0);
    for (const [i, code] of ['starter', 'professional', 'enterprise'].entries()) {
      await page.locator('.lp-comparison-item').nth(i).getByRole('button', { name: 'Prerreservar con 5 % de descuento' }).click();
      await page.getByRole('dialog').waitFor();
      check(`PL-007-code-${code}`, (await page.getByRole('dialog').textContent()).includes(`Prerreserva ${code}`));
      await page.keyboard.press('Escape');
    }
    const essential = page.locator('.lp-service-essential');
    check('PL-003-essential-visible', await essential.isVisible() && (await essential.innerText()).includes('Hardware no incluido'));
    const conditions = page.locator('.lp-service-details');
    const hardware = page.locator('.lp-hardware-option').first();
    check('PL-004-compact-by-default', await page.locator('.lp-hardware-option[open]').count() === 0);
    await conditions.locator('summary').focus(); await page.keyboard.press('Enter');
    check('PL-003-conditions-open', await conditions.getAttribute('open') !== null && (await conditions.innerText()).includes('consultas por correo'));
    await hardware.locator('summary').click();
    check('PL-004-full-equipment', await hardware.locator('li').count() === 4 && (await hardware.innerText()).includes('10 dispositivos personales'));
    check('PL-004-store-production', await hardware.getByRole('link', { name: 'Tienda B2B', exact: true }).getAttribute('href') === 'https://tienda.horizonst.es');
    for (let i = 0; i < 3; i++) {
      const option = page.locator('.lp-hardware-option').nth(i);
      if (await option.getAttribute('open') === null) await option.locator('summary').click();
      check(`PL-004-equipment-${i}`, await option.locator('li').count() === 4 && (await option.innerText()).includes(`${[10, 20, 40][i]} dispositivos personales`));
    }
    await page.screenshot({ path: 'output/playwright/plans-polish-20261029/after-expanded-1440.png', fullPage: true });
    await page.clock.install();
    const calls = requests.catalog;
    revision = 100;
    await hardware.locator('summary').focus();
    await hardware.evaluate(el => el.dataset.replayIdentity = 'same-node');
    await page.clock.fastForward(30001);
    await page.waitForFunction(() => document.querySelector('.lp-comparison-item')?.textContent.includes('616,00'));
    check('PL-005-refreshed-real-interval', requests.catalog > calls);
    check('PL-005-expanded-preserved', await hardware.getAttribute('open') !== null && await conditions.getAttribute('open') !== null);
    check('PL-005-node-focus-preserved', await hardware.evaluate(el => el.dataset.replayIdentity === 'same-node' && document.activeElement === el.querySelector('summary')));
    await page.getByRole('button', { name: 'Prerreservar con 5 % de descuento' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Email profesional' }).fill('fixture@example.invalid');
    await dialog.getByRole('checkbox').check();
    await page.clock.fastForward(30001);
    check('PL-005-modal-preserved', await dialog.isVisible() && await dialog.getByRole('checkbox').evaluate(el => document.activeElement === el));
    await page.keyboard.press('Escape');
    check('PL-005-modal-focus-return', await page.getByRole('button', { name: 'Prerreservar con 5 % de descuento' }).first().evaluate(el => document.activeElement === el));
    mode = 'error'; await page.clock.fastForward(30001);
    await page.getByRole('alert').filter({ hasText: 'No se pudieron actualizar' }).waitFor();
    const retainedAction = page.getByRole('button', { name: 'Prerreservar con 5 % de descuento' }).first();
    check('PL-005-transient-error-preserves-focus', await retainedAction.evaluate(el => document.activeElement === el));
    check('PL-005-transient-error-preserves-details', await conditions.getAttribute('open') !== null && await hardware.getAttribute('open') !== null);
    check('PL-002-stale-action-blocked', await retainedAction.getAttribute('aria-disabled') === 'true');
    await retainedAction.evaluate(el => el.click()); check('PL-002-stale-no-modal', await page.getByRole('dialog').count() === 0);
    mode = 'normal'; revision = 200; await page.clock.fastForward(30001);
    await page.waitForFunction(() => document.querySelector('.lp-comparison-item')?.textContent.includes('617,00'));
    check('PL-002-transient-recovery', await retainedAction.getAttribute('aria-disabled') === null);
    await hardware.locator('summary').focus(); await page.keyboard.press('Space');
    check('PL-005-hardware-keyboard-close', await hardware.getAttribute('open') === null);
    campaignActive = false;
    await page.clock.fastForward(30001);
    await page.getByRole('link', { name: 'Consultar condiciones actuales' }).first().waitFor();
    check('PL-007-expired-actions', await page.getByRole('button', { name: 'Prerreservar con 5 % de descuento' }).count() === 0);
    for (const state of ['partial', 'empty', 'error', 'normal']) {
      mode = state; await page.goto('https://horizonst.es/planes');
      if (state === 'error') await page.getByRole('alert').waitFor();
      else if (state === 'empty') await page.getByText('No hay planes disponibles', { exact: false }).waitFor();
      else {
        await page.getByRole('heading', { name: 'Compara capacidad y cuota' }).waitFor();
        if (state === 'partial') {
          check('PL-002-partial', await page.locator('.lp-comparison-item').count() === 2);
          check('PL-002-unknown', (await page.locator('.lp-comparison-item').last().innerText()).includes('Contactar') && (await page.locator('.lp-comparison-item').last().innerText()).includes('Consultar'));
        }
      }
      check(`PL-002-${state}`, true);
    }
    mode = 'normal'; campaignActive = true; revision = 0;
    await page.goto('https://horizonst.com.es/planes');
    await page.locator('.lp-hardware-option').first().locator('summary').click();
    check('PL-004-store-staging', await page.locator('.lp-hardware-option').first().getByRole('link', { name: 'Tienda B2B', exact: true }).getAttribute('href') === 'https://tienda.horizonst.com.es');
    check('PL-007-no-submissions', requests.posts === 0);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const [path, label] of [['/', 'inicio'], ['/info-faqs', 'funcionamiento'], ['/contacto', 'contacto']]) {
        await page.goto('https://horizonst.es' + path);
        await page.locator('img').evaluateAll(images => Promise.all(images.map(image => { image.loading = 'eager'; return image.decode(); })));
        check(`PL-005-${label}-${width}-no-overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: `output/playwright/plans-polish-20261029/regression-${width === 390 ? 'mobile' : 'desktop'}-${label}.png`, fullPage: true });
      }
    }
  }
  return { stage: after ? 'after' : 'before', fixtures: { prices: [61500, 82500, 125000], tags: [10, 20, 40], gateways: [5, 10, 20] }, measures, checks, requests };
}
