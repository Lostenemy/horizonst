// Valid synthetic Brotli response only; this is not an exploit.
const http = require('node:http');
const zlib = require('node:zlib');
const payload = zlib.brotliCompressSync(Buffer.from('horizonst-brotli-validation'));
http.createServer((req,res) => {
 res.writeHead(200, {'Content-Type':'text/plain','Content-Encoding':'br','Content-Length':payload.length});
 res.end(payload);
}).listen(8088,'0.0.0.0');
