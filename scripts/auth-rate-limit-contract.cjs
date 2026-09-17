const assert = require('node:assert/strict');

exports.checkRateLimit = async function (createAuthRateLimit) {
  let now = 0;
  const counters = new Map();
  const writes = [];
  const store = { async query(sql, values) {
    if (sql.startsWith('DELETE')) return { rows: [] };
    assert.match(sql, /ON CONFLICT \(bucket_key\) DO UPDATE/);
    assert.match(sql, /clock_timestamp\(\)/);
    assert.match(values[0], /^[a-f0-9]{64}$/);
    assert.equal(values[1], 900);
    writes.push(values[0]);
    const previous = counters.get(values[0]);
    const row = !previous || previous.expires <= now ? { attempts: 1, expires: now + values[1] } : { ...previous, attempts: previous.attempts + 1 };
    counters.set(values[0], row);
    return { rows: [{ ...row, retry_after: row.expires - now }] };
  } };
  const replicas = [createAuthRateLimit(store), createAuthRateLimit(store)];
  const invoke = async (limiter, account = 'Person@Example.test', extra = {}) => {
    const req = { path: '/login', method: 'POST', ip: '198.51.100.10', socket: { remoteAddress: '172.18.0.1' }, headers: {}, body: { email: account }, ...extra };
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    let passed = false;
    await limiter(req, res, () => { passed = true; });
    return { ...res, passed };
  };
  await invoke(replicas[0], '', { ip: '198.51.100.20', socket: { remoteAddress: '10.0.0.1' } });
  const firstSource = writes.at(-1);
  await invoke(replicas[1], '', { ip: '198.51.100.20', socket: { remoteAddress: '10.0.0.2' } });
  assert.equal(writes.at(-1), firstSource, 'same effective client IP shares its source bucket');
  await invoke(replicas[0], '', { ip: '198.51.100.21', socket: { remoteAddress: '10.0.0.1' } });
  assert.notEqual(writes.at(-1), firstSource, 'different effective client IP has an independent source bucket');

  for (let i = 0; i < 10; i++) assert.equal((await invoke(replicas[i % 2])).passed, true);
  const blocked = await invoke(replicas[1], ' person@example.test ', { headers: { 'x-forwarded-for': 'forged, 203.0.113.5' } });
  assert.equal(blocked.code, 429, 'source+account budget remains 10');
  assert.equal(blocked.headers['Retry-After'], '900');

  const sourceIp = '198.51.100.30';
  for (let i = 0; i < 120; i++) assert.equal((await invoke(replicas[i % 2], '', { ip: sourceIp })).passed, true);
  assert.equal((await invoke(replicas[0], '', { ip: sourceIp })).code, 429, 'source budget remains 120');

  const limitedAccount = 'account-limit@example.test';
  for (let i = 0; i < 30; i++) {
    assert.equal((await invoke(replicas[i % 2], limitedAccount, { ip: `192.0.2.${i + 1}` })).passed, true);
  }
  assert.equal((await invoke(replicas[0], limitedAccount, { ip: '192.0.2.200' })).code, 429, 'account budget remains 30');

  assert.equal((await invoke(replicas[0], 'other@example.test')).passed, true);
  await invoke(replicas[0], '', { ip: '198.51.100.40', body: { email: '', password: 'clear-password-marker', token: 'clear-token-marker' } });
  const before = writes.length;
  assert.equal((await invoke(replicas[0], '', { path: '/me', method: 'GET' })).passed, true);
  assert.equal((await invoke(replicas[0], '', { path: '/hardware/presence' })).passed, true);
  assert.equal(writes.length, before, 'presence and authenticated reads do not consume auth budgets');
  assert.equal(JSON.stringify(writes).includes('198.51.100'), false, 'IP addresses are not stored in cleartext');
  assert.equal(JSON.stringify(writes).includes('example.test'), false, 'account identifiers are not stored in cleartext');
  assert.equal(JSON.stringify(writes).includes('clear-password-marker'), false, 'passwords are not stored in cleartext');
  assert.equal(JSON.stringify(writes).includes('clear-token-marker'), false, 'tokens are not stored in cleartext');
  now = 901;
  assert.equal((await invoke(replicas[0])).passed, true);
  const unavailable = createAuthRateLimit({ query: async () => { throw new Error('private database detail'); } });
  const failure = await invoke(unavailable);
  assert.equal(failure.code, 503);
  assert.equal(failure.passed, false);
  assert.ok(!JSON.stringify(failure.body).includes('private'));
};
