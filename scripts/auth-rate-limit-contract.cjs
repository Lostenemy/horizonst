const assert = require('node:assert/strict');

exports.checkRateLimit = async function (createAuthRateLimit) {
  let now = 0;
  const counters = new Map();
  const sqlSeen = [];
  const store = { async query(sql, values) {
    sqlSeen.push(sql);
    if (sql.startsWith('DELETE')) return { rows: [] };
    assert.match(sql, /ON CONFLICT \(bucket_key\) DO UPDATE/);
    assert.match(sql, /clock_timestamp\(\)/);
    assert.match(values[0], /^[a-f0-9]{64}$/);
    const previous = counters.get(values[0]);
    const row = !previous || previous.expires <= now ? { attempts: 1, expires: now + values[1] } : { ...previous, attempts: previous.attempts + 1 };
    counters.set(values[0], row);
    return { rows: [{ ...row, retry_after: row.expires - now }] };
  } };
  const replicas = [createAuthRateLimit(store), createAuthRateLimit(store)];
  const invoke = async (limiter, account = 'Person@Example.test', extra = {}) => {
    const req = { path: '/login', method: 'POST', socket: { remoteAddress: '127.0.0.1' }, body: { email: account }, ...extra };
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    let passed = false;
    await limiter(req, res, () => { passed = true; });
    return { ...res, passed };
  };
  for (let i = 0; i < 10; i++) assert.equal((await invoke(replicas[i % 2])).passed, true);
  const blocked = await invoke(replicas[1], ' person@example.test ', { headers: { 'x-forwarded-for': 'forged' } });
  assert.equal(blocked.code, 429);
  assert.equal(blocked.headers['Retry-After'], '900');
  assert.equal((await invoke(replicas[0], 'other@example.test')).passed, true);
  const before = sqlSeen.length;
  assert.equal((await invoke(replicas[0], '', { path: '/me', method: 'GET' })).passed, true);
  assert.equal((await invoke(replicas[0], '', { path: '/hardware/presence' })).passed, true);
  assert.equal(sqlSeen.length, before, 'presence and authenticated reads do not consume auth budgets');
  now = 901;
  assert.equal((await invoke(replicas[0])).passed, true);
  const unavailable = createAuthRateLimit({ query: async () => { throw new Error('private database detail'); } });
  const failure = await invoke(unavailable);
  assert.equal(failure.code, 503);
  assert.equal(failure.passed, false);
  assert.ok(!JSON.stringify(failure.body).includes('private'));
};
