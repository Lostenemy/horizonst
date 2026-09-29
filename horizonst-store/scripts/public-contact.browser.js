(async (page) => {
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);
  const local = 'http://127.0.0.1:4173';
  const marketingHosts = ['horizonst.es', 'www.horizonst.es', 'horizonst.com.es', 'www.horizonst.com.es'];
  const hosts = [...marketingHosts, 'tienda.horizonst.es', 'tienda.horizonst.com.es'];
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let mode = 'error'; let pending; const requests = [];
  // Interceptar TODOS los recursos antes de navegar: solo fetch a la preview loopback.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!hosts.includes(url.hostname)) return route.abort();
    const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/api/contact') {
      requests.push(JSON.parse(route.request().postData()));
      if (mode === 'pending') { pending = () => reply(200, { ok: true }); return; }
      return mode === 'success' ? reply(200, { ok: true }) : reply(mode === 'limit' ? 429 : 503, { error: 'contact_temporarily_unavailable' });
    }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/catalog/saas-plans') return reply(200, { saasPlans: [] });
      if (url.pathname === '/api/public/prereservation/campaign') return reply(200, { active: true, endAt: '2027-01-01T22:59:59.999Z', codes: ['starter', 'professional', 'enterprise'] });
      return reply(401, {});
    }
    return route.fulfill({ response: await route.fetch({ url: `${local}${url.pathname}${url.search}` }) });
  });
  let journeys = 0;
  for (const host of marketingHosts) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`http://${host}/`);
      await page.locator('.lp-nav').waitFor();
      check(await page.getByRole('link', { name: 'Consultar mi instalación', exact: true }).count() === 0, 'Removed CTA');
      check(JSON.stringify(await page.locator('.lp-nav-links a').allTextContents()) === JSON.stringify(['Inicio', 'Planes', 'Cómo funciona', 'Contacto']), 'Public menu order');
      check(await page.getByRole('link', { name: 'Tienda B2B', exact: true }).first().getAttribute('href') === `https://${host.endsWith('.com.es') ? 'tienda.horizonst.com.es' : 'tienda.horizonst.es'}`, 'Shop stays in environment');
      const navContact = page.locator('.lp-nav').getByRole('link', { name: 'Contacto', exact: true });
      check(await navContact.isVisible(), 'Contact visible on mobile and desktop');
      await navContact.click();
      await page.getByRole('heading', { name: 'Contacto', exact: true }).waitFor();
      check(page.url() === `http://${host}/contacto`, 'Contact stays on host');
      check(await page.title() === 'Contacto | HorizonST', 'Specific title');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal overflow');
      const name = page.getByLabel('Nombre', { exact: true });
      const email = page.getByLabel('Correo electrónico', { exact: true });
      const message = page.getByLabel('Mensaje', { exact: true });
      const privacy = page.locator('#contact-privacy');
      const submit = page.getByRole('button', { name: 'Enviar mensaje', exact: true });
      const before = requests.length;
      await submit.click();
      await page.getByRole('alert').waitFor();
      check(await name.evaluate((el) => el === document.activeElement), 'Invalid first field focused');
      check(await name.getAttribute('aria-invalid') === 'true', 'Accessible invalid field');
      check(requests.length === before, 'Invalid form never sends');
      await name.fill('Persona ficticia'); await name.focus(); await page.keyboard.press('Tab');
      check(await email.evaluate((el) => el === document.activeElement), 'Keyboard goes name to email');
      await email.fill('invalid'); await message.fill('Consulta comercial ficticia de navegador.');
      await privacy.focus(); await page.keyboard.press('Space');
      check(await privacy.isChecked(), 'Consent can be accepted with keyboard');
      await submit.click();
      check(await email.evaluate((el) => el === document.activeElement), 'Invalid email focused');
      check(requests.length === before, 'Invalid email never sends');
      await email.fill('contact@example.test'); await privacy.focus();
      await page.keyboard.press('Tab');
      check(await page.getByRole('link', { name: 'política de privacidad', exact: true }).evaluate((el) => el === document.activeElement), 'Privacy link keyboard accessible');
      await page.keyboard.press('Tab');
      check(await submit.evaluate((el) => el === document.activeElement), 'Submit keyboard accessible');
      mode = 'error'; await page.keyboard.press('Enter');
      await page.getByRole('alert').filter({ hasText: 'No se ha podido confirmar' }).waitFor();
      check(await name.inputValue() === 'Persona ficticia' && await email.inputValue() === 'contact@example.test' && await message.inputValue() === 'Consulta comercial ficticia de navegador.' && await privacy.isChecked(), 'Error preserves all data and consent');
      mode = 'limit'; await submit.click();
      await page.waitForFunction(() => document.querySelector('form').getAttribute('aria-busy') === 'false');
      check(await message.inputValue() === 'Consulta comercial ficticia de navegador.', 'Rate limit preserves message');
      mode = 'pending'; pending = undefined; const pendingBefore = requests.length; await submit.click();
      await page.getByRole('status').filter({ hasText: 'Enviando tu mensaje' }).waitFor();
      check(await page.getByRole('button', { name: 'Enviando...' }).isDisabled(), 'Sending disables submit');
      check(await page.locator('form').getAttribute('aria-busy') === 'true', 'Sending announced');
      await page.locator('form').evaluate((el) => {
        el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await page.waitForFunction(() => document.querySelector('form').getAttribute('aria-busy') === 'true');
      // La petición interceptada permanece pendiente hasta esta confirmación simulada.
      for (let i = 0; !pending && i < 20; i++) await page.waitForTimeout(10);
      check(typeof pending === 'function', 'Intercepted pending transport');
      check(requests.length === pendingBefore + 1, 'Concurrent submit guarded');
      await pending(); await page.getByRole('status').filter({ hasText: 'Mensaje enviado.' }).waitFor();
      check(await submit.isDisabled() && await name.inputValue() === '' && await message.inputValue() === '', 'Confirmed success clears data and blocks repeat');
      check(Object.keys(requests.at(-1)).sort().join(',') === 'email,fullName,message,privacyAccepted,website', 'Client cannot supply recipient or sender');
      await page.getByRole('link', { name: 'política de privacidad', exact: true }).click();
      await page.getByRole('heading', { name: 'Política de privacidad', exact: true }).waitFor();
      check(page.url() === `http://${host}/privacidad`, 'Privacy stays in environment');
      await page.locator('.lp-nav').getByRole('link', { name: 'Inicio', exact: true }).click();
      await page.locator('.lp-hero').waitFor(); check(page.url() === `http://${host}/`, 'Inicio returns same commercial home');
      journeys++;
    }
  }
  for (const host of hosts.filter((host) => host.startsWith('tienda.'))) {
    await page.goto(`http://${host}/`); await page.locator('.topbar').waitFor();
    check(await page.title() === 'Tienda B2B | HorizonST Store', 'Shop not replaced by public form');
  }
  check(errors.length === 0, errors.join('; '));
  return { result: 'passed', journeys, widths: [390, 1440], marketingHosts, requests: requests.length, browserErrors: errors.length, transport: 'simulated', shopHostsPreserved: 2 };
})
