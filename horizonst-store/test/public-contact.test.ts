import assert from 'node:assert/strict';
import express from 'express';
import { createContactRouter, contactSchema, type ContactInput } from '../src/modules/contact/contact.routes.js';
import { buildPublicContactEmail, sendPublicContactEmail } from '../src/modules/shared/mail.js';
import { env } from '../src/config/env.js';

// Doble compartido de la primitiva SQL atómica; no abre conexiones PostgreSQL.
class MemoryStore {
  rows = new Map<string, { attempts: number; expires: number }>();
  values: any[][] = [];
  now = 0;
  fail = false;
  failReceipt = false;
  async query(sql: string, values: any[] = []) {
    if (this.fail) throw new Error('SQL with private diagnostic');
    this.values.push(values);
    const key = values[0];
    if (sql.startsWith('DELETE')) {
      for (const [k, row] of this.rows) if (row.expires <= this.now) this.rows.delete(k);
      return { rows: [] };
    }
    const old = this.rows.get(key);
    if (sql.includes('AS budget')) {
      const row = old && old.expires > this.now ? { ...old, attempts: old.attempts + 1 }
        : { attempts: 1, expires: this.now + values[1] * 1000 };
      this.rows.set(key, row);
      return { rows: [{ attempts: row.attempts, retry_after: Math.ceil((row.expires - this.now) / 1000) }] };
    }
    if (sql.includes('AS delivery')) {
      if (old && old.expires > this.now) return { rows: [] };
      this.rows.set(key, { attempts: 1, expires: this.now + 900_000 });
      return { rows: [{ attempts: 1 }] };
    }
    if (sql.startsWith('SELECT')) return { rows: old ? [{ attempts: old.attempts }] : [] };
    if (sql.includes('SET attempts = 2') && this.failReceipt) throw new Error('receipt failed');
    if (sql.startsWith('UPDATE') && old?.attempts === 1) {
      old.attempts = sql.includes('SET attempts = 2') ? 2 : 3;
      return { rows: [{ attempts: old.attempts }] };
    }
    throw new Error('Unexpected SQL in contact test');
  }
}
const valid: ContactInput = { fullName: 'Persona de prueba', email: 'ana@example.test', message: 'Consulta comercial ficticia.', privacyAccepted: true, website: '' };
let passed = 0;
async function check(name: string, run: () => Promise<void> | void) { await run(); passed++; console.log(`Public contact: ${name}: OK`); }
async function withApi(run: (post: (body: any, ip?: string, raw?: string) => Promise<Response>, store: MemoryStore) => Promise<void>,
  deliver: (input: ContactInput) => Promise<void> = async () => {}, store = new MemoryStore(), enabled = true) {
  const app = express();
  app.set('trust proxy', (ip: string) => ip === '127.0.0.1');
  app.use('/api/contact', createContactRouter({ store, deliver, enabled: () => enabled }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const post = (body: any, ip = '192.0.2.10', raw?: string) => fetch(`http://127.0.0.1:${address.port}/api/contact`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: raw ?? JSON.stringify(body)
  });
  try { await run(post, store); } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}
await check('valid message, fixed recipient, normalized Reply-To and no clear personal data in counters', async () => {
  let mail: ReturnType<typeof buildPublicContactEmail> | undefined;
  await withApi(async (post, store) => {
    const result = await post({ ...valid, email: 'ANA@example.test' });
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true });
    assert.equal(mail?.to, 'comercial@horizonst.es'); assert.equal(mail?.replyTo, 'ana@example.test');
    assert.equal(mail?.subject, 'Nuevo mensaje de contacto HorizonST');
    assert.ok([...store.rows.keys()].every((key) => /^[a-f0-9]{64}$/.test(key)));
    assert.doesNotMatch(JSON.stringify(store.values), /ana@|Persona|Consulta|192\.0\.2/);
  }, async (input) => { mail = buildPublicContactEmail(input); });
});
await check('strict fields, consent, limits, header injection and honeypot', async () => {
  let deliveries = 0;
  const invalid = [
    { fullName: 'a' }, { fullName: 'a'.repeat(201) }, { fullName: 'Name\r\nBcc: injected@example.test' },
    { email: 'invalid' }, { email: 'valid@example.test\r\nBcc: injected@example.test' }, { message: 'short' },
    { message: 'a'.repeat(2001) }, { message: 'message with\u0000 null' }, { privacyAccepted: false },
    { recipient: 'other@example.test' }, { replyTo: 'other@example.test' }, { website: 'robot' }
  ];
  for (const change of invalid) {
    await withApi(async (post) => {
      const result = await post({ ...valid, ...change }); assert.equal(result.status, 400);
      assert.doesNotMatch(await result.text(), /injected@|other@|robot|Bcc/);
    }, async () => { deliveries++; });
  }
  assert.equal(deliveries, 0);
  assert.equal(contactSchema.safeParse({ ...valid, message: 'Dos líneas\npermitidas.' }).success, true);
});
await check('SMTP disabled is unavailable, never success', async () => {
  await withApi(async (post) => { const result = await post(valid); assert.equal(result.status, 503); }, async () => { assert.fail('must not deliver'); }, new MemoryStore(), false);
  const before = env.mail.enabled;
  try { env.mail.enabled = false; await assert.rejects(sendPublicContactEmail(valid, async () => { assert.fail('disabled transport'); }), /contact_mail_disabled/); }
  finally { env.mail.enabled = before; }
});
await check('enabled wrapper ignores configurable commercial recipient and propagates transport failure', async () => {
  const before = { enabled: env.mail.enabled, commercialTo: env.mail.commercialTo };
  try {
    env.mail.enabled = true; env.mail.commercialTo = 'different@example.test';
    await sendPublicContactEmail(valid, async (mail) => {
      assert.equal(mail.to, 'comercial@horizonst.es'); assert.equal(mail.replyTo, valid.email);
    });
    await assert.rejects(sendPublicContactEmail(valid, async () => { throw new Error('simulated failure'); }), /simulated failure/);
  } finally { Object.assign(env.mail, before); }
});
await check('SMTP failure is generic, data is not logged and duplicate retry is not redelivered', async () => {
  let deliveries = 0; const logs: any[] = []; const original = console.error;
  console.error = (...args) => { logs.push(args); };
  try {
    await withApi(async (post) => {
      for (let n = 0; n < 2; n++) {
        const result = await post(valid); assert.equal(result.status, 503);
        assert.deepEqual(await result.json(), { error: 'contact_temporarily_unavailable' });
      }
    }, async () => { deliveries++; throw new Error('SMTP private secret ana@example.test'); });
    assert.equal(deliveries, 1); assert.deepEqual(logs, []);
  } finally { console.error = original; }
});
await check('concurrent requests and retry after acceptance send once', async () => {
  let release!: () => void; let entered!: () => void; let deliveries = 0;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const called = new Promise<void>((resolve) => { entered = resolve; });
  await withApi(async (post) => {
    const first = post(valid); await called;
    const second = await post(valid); assert.equal(second.status, 409); assert.equal(second.headers.get('retry-after'), '30');
    release(); assert.equal((await first).status, 200);
    const third = await post(valid); assert.deepEqual(await third.json(), { ok: true, duplicate: true });
    assert.equal(deliveries, 1);
  }, async () => { deliveries++; entered(); await wait; });
});
await check('shared-store duplicate across replicas and expiring reservation', async () => {
  const store = new MemoryStore(); let deliveries = 0;
  const deliver = async () => { deliveries++; };
  await withApi(async (post) => { assert.equal((await post(valid)).status, 200); }, deliver, store);
  await withApi(async (post) => { assert.equal((await post(valid)).status, 200); }, deliver, store);
  assert.equal(deliveries, 1);
  store.now += 900_001;
  await withApi(async (post) => { assert.equal((await post(valid)).status, 200); }, deliver, store);
  assert.equal(deliveries, 2);
});
await check('receipt persistence failure does not report success or resend', async () => {
  const store = new MemoryStore(); store.failReceipt = true; let deliveries = 0;
  await withApi(async (post) => {
    assert.equal((await post(valid)).status, 503);
    assert.equal((await post(valid)).status, 409);
  }, async () => { deliveries++; }, store);
  assert.equal(deliveries, 1);
});
await check('source hourly limit and independent origin', async () => {
  await withApi(async (post, store) => {
    for (let n = 0; n < 5; n++) assert.equal((await post({ ...valid, email: `test${n}@example.test` })).status, 200);
    const denied = await post({ ...valid, email: 'sixth@example.test' });
    assert.equal(denied.status, 429); assert.equal(denied.headers.get('retry-after'), '3600');
    assert.equal((await post({ ...valid, email: 'other@example.test' }, '192.0.2.11')).status, 200);
    store.now += 3_600_001;
    assert.equal((await post({ ...valid, email: 'later@example.test' })).status, 200);
  });
});
await check('account hourly limit across origins', async () => {
  await withApi(async (post) => {
    for (let n = 0; n < 3; n++) assert.equal((await post({ ...valid, message: valid.message + n }, `192.0.2.${20 + n}`)).status, 200);
    assert.equal((await post({ ...valid, message: valid.message + 'four' }, '192.0.2.25')).status, 429);
  });
});
await check('fail-closed store', async () => {
  const store = new MemoryStore(); store.fail = true;
  await withApi(async (post) => { const result = await post(valid); assert.equal(result.status, 503); assert.doesNotMatch(await result.text(), /SQL|private/); }, async () => assert.fail('no transport'), store);
});
await check('parser byte limit and malformed JSON are sanitized', async () => {
  await withApi(async (post) => {
    assert.equal((await post({}, undefined, JSON.stringify({ message: 'z'.repeat(13000) }))).status, 413);
    const malformed = await post({}, undefined, '{"email":"private@example.test"');
    assert.equal(malformed.status, 400); assert.equal(await malformed.text(), '{"error":"invalid_contact_body"}');
  });
});
await check('mail HTML escapes supplied content and preserves body newlines', () => {
  const mail = buildPublicContactEmail({ ...valid, fullName: '<img src=x>', message: '<script>bad</script>\nOtra línea.' });
  assert.doesNotMatch(mail.html, /<script>|<img/); assert.match(mail.html, /&lt;script&gt;/); assert.match(mail.html, /<br>Otra línea/);
});
console.log(`Public contact: ${passed} checks passed, 0 failed, 0 skipped (SMTP and DB simulated)`);
