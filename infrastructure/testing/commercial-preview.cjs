'use strict';
// Read-only loopback preview of an already-built isolated frontend. NO backend/proxy.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(process.argv[2] || '');
if (!fs.statSync(path.join(root, 'index.html')).isFile()) throw new Error('Built frontend required');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end('Preview does not accept submissions'); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  if (pathname.startsWith('/api/')) { res.writeHead(503); res.end('No backend in preview'); return; }
  const relative = pathname.replace(/^\/+/, '');
  let file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
  if (!path.extname(file)) file = path.join(root, 'index.html');
  if (!mime[path.extname(file)]) { res.writeHead(404); res.end(); return; }
  try {
    file = fs.realpathSync(file);
    if (!file.startsWith(root + path.sep)) throw new Error('Outside preview');
    const content = fs.readFileSync(file);
    if (path.extname(file) === '.mp4' && req.headers.range) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      const start = range ? Number(range[1]) : -1;
      const end = range && range[2] ? Math.min(Number(range[2]), content.length - 1) : content.length - 1;
      if (!range || start >= content.length || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${content.length}` }); res.end(); return; }
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${content.length}`, 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
      res.end(content.subarray(start, end + 1)); return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(0, '127.0.0.1', () => console.log(`Local read-only preview: http://127.0.0.1:${server.address().port}`));
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; server.close(); server.closeAllConnections(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
