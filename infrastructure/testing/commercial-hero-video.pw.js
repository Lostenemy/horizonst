// Local static preview only; do not contact real APIs or external hosts.
async page => {
  const origin = new URL(page.url());
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw new Error('Loopback preview required');
  const errors = []; let writes = 0; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() !== 'GET') { writes++; return route.abort(); }
    if (url.hostname !== 'horizonst.com.es' || url.pathname.startsWith('/api/')) return route.abort();
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' });
    const range = request.headers().range;
    return route.fulfill({ response: await page.request.get(origin.origin + url.pathname, range ? { headers: { range } } : {}) });
  });
  const checks = [];
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.goto('https://horizonst.com.es/');
    const video = page.locator('video.commercial-hero-video');
    await video.waitFor();
    await page.waitForFunction(() => { const video = document.querySelector('video'); return video && video.readyState >= 1; });
    const metadata = await video.evaluate(v => ({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, controls: v.controls, autoplay: v.autoplay, paused: v.paused, source: v.currentSrc }));
    if (metadata.width !== 1280 || metadata.height !== 720 || metadata.duration < 20 || metadata.duration > 25 || !metadata.controls || metadata.autoplay || !metadata.paused) throw new Error('Invalid video metadata: ' + JSON.stringify(metadata));
    if (await page.locator('.lp-hero .commercial-visual').count() !== 0) throw new Error('Original hero image remains');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Horizontal overflow at ' + width);
    await video.evaluate(v => { v.currentTime = Math.min(5, v.duration - 1); });
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.seeking && v.readyState >= 2 && v.currentTime >= 4.9; });
    await video.evaluate(v => { v.muted = true; return v.play(); });
    await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 5; });
    await video.evaluate(v => v.pause());
    await page.screenshot({ path: `output/playwright/hero-video-20261110/hero-${width}.png`, fullPage: true });
    checks.push({ width, metadata, playedAndPaused: true });
  }
  if (writes || errors.length) throw new Error(JSON.stringify({ writes, errors }));
  return { checks, writes, errors, scope: 'loopback; simulated host; no external service' };
}
