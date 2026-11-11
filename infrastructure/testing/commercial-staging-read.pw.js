// Public staging inspection only. No authentication, submissions or non-GET requests.
async page => {
  if (page.url() !== 'about:blank') throw new Error('Use a fresh blank read-only session');
  const responses = [], blocked = [], pages = [];
  const onResponse = response => { const url = new URL(response.url()); if (url.pathname.startsWith('/images/')) responses.push({ path: url.pathname, status: response.status() }); };
  page.on('response', onResponse);
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET' || url.origin !== 'https://horizonst.com.es') { blocked.push({ method: request.method(), host: url.hostname }); return route.abort(); }
    return route.continue();
  });
  try {
    for (const path of ['/', '/info-faqs']) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto('https://horizonst.com.es' + path);
      await page.evaluate(async () => { for (const image of document.images) { image.scrollIntoView(); await image.decode().catch(() => {}); } await document.fonts.ready; window.scrollTo(0, 0); });
      pages.push({ path, ...await page.evaluate(() => ({
        title: document.querySelector('h1')?.textContent,
        headings: [...document.querySelectorAll('h2')].map(el => el.textContent),
        intro: document.querySelector('.lp-hero p:not(.eyebrow)')?.textContent,
        images: [...document.images].map(img => ({ src: new URL(img.currentSrc || img.src).pathname, loaded: img.complete && img.naturalWidth > 0,
          width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height }))
      })) });
      await page.screenshot({ path: `output/playwright/smartracking-20261104/staging-${path === '/' ? 'inicio' : 'funcionamiento'}.png`, fullPage: true });
    }
    return { origin: 'https://horizonst.com.es', pages, responses, blocked, scope: 'public GET only; no login, form submission or changes' };
  } finally { page.off('response', onResponse); }
}
