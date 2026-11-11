import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = fileURLToPath(new URL('../web/', import.meta.url));
const bundle = await import(pathToFileURL(path.join(web, 'dist-ssr/prerender.js')).href);
const template = await readFile(path.join(web, 'dist/index.html'), 'utf8');
const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
for (const [environment, hostname] of [['production', 'horizonst.es'], ['staging', 'horizonst.com.es']]) {
  for (const route of bundle.paths) {
    globalThis.window = { location: { hostname, pathname: route, search: '' } };
    const { html, title, description } = bundle.render(route);
    const canonical = 'https://horizonst.es' + route;
    const meta = `<meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(canonical)}">${environment === 'staging' ? '<meta name="robots" content="noindex, nofollow">' : ''}`;
    const note = route === '/planes' ? '<noscript><p>Los precios y las campañas se consultan en tiempo real y requieren JavaScript. <a href="/contacto?motivo=presupuesto">Solicitar presupuesto</a>.</p></noscript>' : '';
    const output = template.replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>${meta}`).replace('<div id="root"></div>', `<div id="root" data-prerendered="true">${html}</div>${note}`);
    if (!output.includes('data-prerendered="true"')) throw new Error(`Prerender root missing: ${route}`);
    const target = path.join(web, 'dist/prerender', environment, route === '/' ? 'index.html' : `${route.slice(1)}.html`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, output);
  }
}
delete globalThis.window;
console.log(`Prerendered ${bundle.paths.length} public paths for production and staging`);
