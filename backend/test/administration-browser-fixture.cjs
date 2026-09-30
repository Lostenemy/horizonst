// Servidor exclusivamente local con inventario ficticio, sin cargar app/config/.env.
// node test/administration-browser-fixture.cjs; detener con Ctrl+C al terminar.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../public');
const devices = Array.from({ length: 13 }, (_, i) => ({ id: i + 1, name: `Dispositivo ficticio ${i + 1}`,
  ble_mac: `ABCDEF${String(i + 1).padStart(6, '0')}`, active: true, device_type: 'b5', company_name: 'Fixture', last_seen_at: null }));
const gateways = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, mac_address: `abcdef${String(i + 1).padStart(6, '0')}`,
  company_name: 'Fixture', company_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', active: true }));
const data = { '/devices': devices, '/gateways': gateways, '/users': [], '/companies': [], '/categories': [], '/alarms': [], '/messages': [], '/users/groups': [], '/alarms/configs': [] };
let failure = '';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  if (url.pathname === '/fixture/control') { failure = url.searchParams.get('failure') || ''; res.end('fixture only'); return; }
  if (url.pathname.startsWith('/administracion/api/')) {
    const route = url.pathname.slice('/administracion/api'.length);
    res.setHeader('Content-Type', 'application/json');
    if (route === failure) { res.writeHead(403).end(JSON.stringify({ message: 'Fixture denied' })); return; }
    res.end(JSON.stringify(data[route] ?? [])); return;
  }
  const relative = url.pathname.replace(/^\/administracion\//, '');
  if (!/^(?:[a-z-]+\.html|styles\.css|js\/[a-z-]+\.js)$/.test(relative)) { res.writeHead(404).end(); return; }
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(target));
});
server.listen(0, '127.0.0.1', () => console.log(`Fixture: http://127.0.0.1:${server.address().port}/administracion/index.html`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
