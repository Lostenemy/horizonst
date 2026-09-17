const assert = require('node:assert/strict');
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

async function requestIp(express, configureTrustProxy, trustedProxyIp, forwardedFor) {
  const app = express();
  configureTrustProxy(app, trustedProxyIp);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const server = app.listen(0, '127.0.0.1');
  try {
    if (!server.listening) {
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
    }
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/ip`, { headers: { 'X-Forwarded-For': forwardedFor } });
    return (await response.json()).ip;
  } finally {
    if (server.listening) await close(server);
  }
}

exports.checkTrustedProxy = async function (express, configureTrustProxy, createTrustedProxy) {
  const exact = createTrustedProxy('172.18.0.1');
  assert.equal(exact('172.18.0.1'), true);
  assert.equal(exact('::ffff:172.18.0.1'), true, 'IPv4-mapped representation is the same exact proxy');
  assert.equal(exact('172.18.0.2'), false);
  assert.equal(createTrustedProxy(undefined)('172.18.0.1'), false, 'missing configuration trusts nobody');
  assert.throws(() => createTrustedProxy('172.18.0.0/16'), /one exact IP address/);

  const first = await requestIp(express, configureTrustProxy, '127.0.0.1', '198.51.100.10');
  const repeated = await requestIp(express, configureTrustProxy, '127.0.0.1', '198.51.100.10');
  const second = await requestIp(express, configureTrustProxy, '127.0.0.1', '198.51.100.11');
  assert.equal(first, repeated);
  assert.notEqual(first, second, 'two clients behind the trusted proxy retain distinct identities');

  const injected = await requestIp(express, configureTrustProxy, '127.0.0.1', '203.0.113.99, 198.51.100.10');
  assert.equal(injected, '198.51.100.10', 'an arbitrary earlier forwarded value is ignored');
  const direct = await requestIp(express, configureTrustProxy, '172.18.0.1', '203.0.113.99');
  assert.notEqual(direct, '203.0.113.99', 'an untrusted direct connection cannot spoof its IP');
};
