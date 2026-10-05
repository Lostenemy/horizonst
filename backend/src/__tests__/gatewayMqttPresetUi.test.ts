import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { buildHorizonstMqttPreset } from '../services/gatewayMqttConfiguration';

class Element {
  children: Element[] = []; style: Record<string, string> = {}; dataset: Record<string, string> = {};
  hidden = false; disabled = false; value = ''; textContent = ''; innerHTML = ''; title = ''; colSpan = 0;
  listeners: Record<string, Function> = {}; classList = { add() {}, remove() {} };
  fields = new Map<string, Element>();
  elements = { namedItem: (name: string) => { if (!this.fields.has(name)) this.fields.set(name, new Element()); return this.fields.get(name)!; } };
  appendChild(child: Element) { this.children.push(child); return child; }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  before() {} closest() { return this; } setAttribute() {}
  addEventListener(event: string, handler: Function) { this.listeners[event] = handler; }
  querySelector() { return new Element(); } querySelectorAll() { return []; }
}
const MAC = 'abcdef000001';
const publicPreset = (environment: 'staging' | 'production' = 'production') => {
  const { passwd: _empty, ...data } = buildHorizonstMqttPreset(MAC, environment);
  return { source: 'proposed', environment, data };
};

async function fixture(observationEnabled = false) {
  const nodes = new Map<string, Element>();
  const get = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id)!; };
  const calls: string[] = []; const posts: any[] = []; const reads: any[] = []; const confirmations: any[] = [];
  let presetFetch = async (): Promise<any> => publicPreset();
  let confirm = async () => true;
  let postFailure: Error | null = null;
  let observationFetch = async () => ({ source: 'observed', correlation: 'unverified', enabled: observationEnabled,
    observation: { public_value: publicPreset().data, observed_at: '2026-10-05T08:00:00Z' } });
  let readPost = async (): Promise<any> => ({ status: 'response_observed' });
  const gateway = { id: 17, mac_address: MAC, active: true, name: 'Fixture gateway', company_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const context = vm.createContext({
    document: { readyState: 'complete', hidden: false, getElementById: get, querySelector: get,
      querySelectorAll: () => [], createElement: () => new Element() },
    initAuthPage: () => ({ user: { role: 'ADMIN' }, isAdmin: true, isHardwareTechnician: false }),
    apiGet: async (url: string) => {
      calls.push(url);
      if (url.endsWith('/mqtt-preset')) return presetFetch();
      if (url === '/gateways') return [gateway];
      if (url.endsWith('/mqtt-observation')) return observationFetch();
      if (url.endsWith('/commands')) return [{ created_at: '2026-01-01T00:00:00Z', msg_id: 1030,
        command_type: 'mqtt_connection_1030', destination_host: 'old-destination.invalid', destination_port: 1883,
        payload: { data: { passwd: 'not-real-history-password' } } }];
      if (url.endsWith('/ble-connected-devices')) return null;
      return [];
    },
    apiPost: async (url: string, body: unknown) => {
      if (url.endsWith('/read-configuration/mqtt_configuration')) { reads.push({ url, body }); return readPost(); }
      posts.push({ url, body: structuredClone(body) }); if (postFailure) throw postFailure; return { message: 'ACK: conexión no verificada' };
    },
    apiPut() {}, apiDelete() {}, openFormModal() {},
    confirmAction: async (options: unknown) => { confirmations.push(options); return confirm(); },
    setInterval() {}, TextEncoder, console
  });
  const js = (file: string) => readFileSync(path.join(process.cwd(), 'public/js', file), 'utf8');
  vm.runInContext(js('load-state.js').replace(/^export /gm, ''), context);
  vm.runInContext(js('gateways.js').replace(/^import .*;\r?\n/gm, ''), context);
  await new Promise(setImmediate);
  context.gatewayFixture = gateway;
  return { get, context, calls, posts, reads, confirmations, field: (name: string) => get('gatewayMqttForm').elements.namedItem(name),
    setPreset: (fetch: typeof presetFetch) => { presetFetch = fetch; }, setConfirm: (callback: typeof confirm) => { confirm = callback; },
    failPost: (error: Error) => { postFailure = error; },
    setRead: (read: typeof readPost) => { readPost = read; },
    setObservation: (read: typeof observationFetch) => { observationFetch = read; },
    open: () => vm.runInContext('selectGateway(gatewayFixture)', context),
    restore: () => get('gatewayMqttRestorePreset').listeners.click(),
    submit: () => get('gatewayMqttForm').listeners.submit({ preventDefault() {} }) };
}

test('opening/restoring uses the public environment proposal, not history, and never starts physical reads/commands', async () => {
  const f = await fixture();
  await f.open();
  assert.equal(f.field('host').value, 'mqtt.horizonst.es');
  assert.equal(f.field('port').value, '8883'); assert.equal(f.field('security_type').value, '1');
  assert.equal(f.field('passwd').value, '');
  f.field('passwd').value = 'ephemeral-test-password';
  f.field('host').value = 'custom.example.invalid';
  await f.restore();
  assert.equal(f.field('passwd').value, ''); assert.equal(f.field('confirmationMac').value, '');
  assert.equal(f.field('host').value, 'mqtt.horizonst.es');
  f.setPreset(async () => publicPreset('staging'));
  await f.restore(); assert.equal(f.field('host').value, 'mqtt.horizonst.com.es');
  assert.equal(f.posts.length, 0); assert.equal(f.reads.length, 0);
  assert(!f.calls.some(url => /read-identity|read-configuration|read-ble|configure-mqtt/.test(url)));
  assert.match(f.get('gatewayMqttPresetStatus').textContent, /No leída/);
});

test('opening reads 2030 once separately, restoring the public proposal never reads or writes', async () => {
  const f = await fixture(true);
  await f.open();
  assert.equal(f.field('host').value, 'mqtt.horizonst.es');
  assert.equal(f.field('port').value, '8883'); assert.equal(f.field('security_type').value, '1');
  assert.equal(f.field('passwd').value, '');
  f.field('passwd').value = 'ephemeral-test-password';
  f.field('host').value = 'custom.example.invalid';
  await f.restore();
  assert.equal(f.field('passwd').value, ''); assert.equal(f.field('confirmationMac').value, '');
  assert.equal(f.field('host').value, 'mqtt.horizonst.es');
  f.setPreset(async () => publicPreset('staging'));
  await f.restore(); assert.equal(f.field('host').value, 'mqtt.horizonst.com.es');
  assert.equal(f.posts.length, 0);
  assert.equal(f.reads.length, 1); assert.equal(f.reads[0].url, '/gateways/17/read-configuration/mqtt_configuration');
  assert.match(f.get('gatewayMqttObservedAt').textContent, /Última recepción guardada/);
  assert(!f.calls.some(url => /read-identity|read-configuration|read-ble|configure-mqtt/.test(url)));
  assert.match(f.get('gatewayMqttPresetStatus').textContent, /No leída/);
});

test('missing/failing/malformed proposal clears values and blocks submission without choosing staging', async () => {
  const f = await fixture(); await f.open();
  for (const failing of [async () => { throw new Error('unavailable'); }, async () => [],
    async () => ({ ...publicPreset(), data: { ...publicPreset().data, passwd: 'must-not-load' } }),
    async () => ({ ...publicPreset(), environment: 'unknown' })]) {
    f.field('passwd').value = 'ephemeral'; f.setPreset(failing); await f.restore();
    assert.equal(f.field('host').value, ''); assert.equal(f.field('passwd').value, '');
    assert.equal(f.get('gatewayMqttSubmit').disabled, true);
    assert.match(f.get('gatewayMqttPresetStatus').textContent, /No se ha elegido ningún destino/);
    await f.submit(); assert.equal(f.posts.length, 0);
  }
  f.setPreset(async () => publicPreset()); await f.restore();
  assert.equal(f.get('gatewayMqttSubmit').disabled, false);
});

test('manual destination/TLS edits require an explicit summary and exact MAC; cancellation clears the secret', async () => {
  const f = await fixture(); await f.open();
  f.field('host').value = 'manual.example.invalid'; f.field('port').value = '1883'; f.field('security_type').value = '0';
  f.field('passwd').value = 'ephemeral-test-password'; f.field('confirmationMac').value = 'wrong';
  await f.submit(); assert.equal(f.posts.length, 0); assert.equal(f.confirmations.length, 0);
  f.field('passwd').value = 'ephemeral-test-password'; f.field('confirmationMac').value = MAC;
  f.setConfirm(async () => false); await f.submit();
  assert.equal(f.posts.length, 0); assert.equal(f.field('passwd').value, '');
  assert.match(f.confirmations[0].message, /abcdef000001.*manual\.example\.invalid.*1883.*SIN TLS/);
  assert.doesNotMatch(f.confirmations[0].message, /ephemeral-test-password/);
  f.setConfirm(async () => true); f.field('passwd').value = 'ephemeral-test-password'; await f.submit();
  assert.equal(f.posts.length, 1); assert.equal(f.posts[0].body.data.host, 'manual.example.invalid');
  assert.equal(f.posts[0].body.data.security_type, 0); assert.equal(f.field('passwd').value, '');
  assert.match(f.get('gatewayMqttFeedback').textContent, /no verificada/);
});

test('pending confirmation prevents duplicate submit and sends the frozen reviewed destination', async () => {
  const f = await fixture(); await f.open();
  f.field('confirmationMac').value = MAC; f.field('passwd').value = 'ephemeral-test-password';
  let resolve!: (value: boolean) => void;
  f.setConfirm(() => new Promise<boolean>(done => { resolve = done; }));
  const pending = f.submit(); await Promise.resolve();
  await f.submit(); assert.equal(f.confirmations.length, 1); assert.equal(f.posts.length, 0);
  assert.equal(f.field('host').disabled, true); assert.equal(f.field('passwd').value, '');
  f.field('host').value = 'changed-after-summary.invalid'; resolve(true); await pending;
  assert.equal(f.posts[0].body.data.host, 'mqtt.horizonst.es');
  assert.equal(f.posts.length, 1);
});

test('late preset cannot overwrite a newer restoration', async () => {
  const f = await fixture(); await f.open();
  let resolve!: (value: unknown) => void;
  f.setPreset(() => new Promise(done => { resolve = done; }));
  const old = f.restore();
  f.setPreset(async () => publicPreset('production')); await f.restore();
  resolve(publicPreset('staging')); await old;
  assert.equal(f.field('host').value, 'mqtt.horizonst.es');
  assert.equal(f.posts.length, 0);
});

test('request failure never echoes the password in UI and still clears the ephemeral field', async () => {
  const f = await fixture(); await f.open();
  f.field('confirmationMac').value = MAC; f.field('passwd').value = 'ephemeral-test-password';
  f.failPost(new Error('server echoed ephemeral-test-password'));
  await f.submit();
  assert.equal(f.field('passwd').value, '');
  assert.doesNotMatch(f.get('gatewayMqttFeedback').textContent, /ephemeral-test-password/);
  assert.match(f.get('gatewayMqttFeedback').textContent, /No se pudo completar/);
});

test('RSSI form shows saved central data separately, opens without commands and rejects blank input', async () => {
  const f = await fixture();
  f.context.gatewayFixture.rssi_threshold = -60;
  await f.open();
  assert.equal(f.get('gatewayRssi').value, -60);
  assert.match(f.get('gatewayRssiSaved').textContent, /guardado central: -60.*No verificado/);
  assert.equal(f.posts.length, 0);
  assert.equal(f.reads.length, 0);
  f.context.gatewayFixture.rssi_threshold = null; await f.open();
  assert.equal(f.get('gatewayRssi').value, '');
  assert.match(f.get('gatewayRssiSaved').textContent, /ausente o inválido/);
  await f.get('gatewayApplyRssi').listeners.click(); assert.equal(f.posts.length, 0);
});

test('explicit physical RSSI updates saved indication only after successful ACK, never claims readback', async () => {
  const f = await fixture(); await f.open();
  f.get('gatewayRssi').value = '-65';
  let status = 'error';
  f.context.apiPost = async (url: string, body: unknown) => { f.posts.push({ url, body }); return { status }; };
  await f.get('gatewayApplyRssi').listeners.click();
  assert.match(f.get('gatewayRssiSaved').textContent, /ausente/);
  assert.match(f.get('gatewayMqttPresetStatus').textContent, /No leída/);
  status = 'success'; await f.get('gatewayApplyRssi').listeners.click();
  assert.equal(f.posts[1].url, '/gateways/17/apply-rssi');
  assert.equal(f.posts[1].body.rssi, -65);
  assert.match(f.confirmations[1].message, /-65.*1042.*No cambia el umbral local/);
  assert.match(f.get('gatewayRssiSaved').textContent, /-65.*tras ACK.*No verificado/);
  assert.match(f.get('gatewayTechnicalFeedback').textContent, /No demuestra el filtro físico actual/);
  assert.equal(f.reads.length, 0);
});

test('integration keeps saved physical RSSI separate from proposed and observed MQTT in both feature modes', async () => {
  for (const enabled of [false, true]) {
    const f = await fixture(enabled);
    f.context.gatewayFixture.rssi_threshold = -60;
    f.setObservation(async () => ({ source: 'observed', correlation: 'unverified', enabled,
      observation: { public_value: { ...publicPreset().data, host: 'observed.example.invalid' }, observed_at: '2026-10-05T08:00:00Z' } }));
    await f.open();
    assert.equal(f.get('gatewayRssi').value, -60);
    assert.match(f.get('gatewayRssiSaved').textContent, /guardado central: -60.*No verificado/);
    assert.equal(f.field('host').value, 'mqtt.horizonst.es');
    assert.equal(f.field('passwd').value, '');
    assert.equal(f.posts.length, 0, 'opening never requests RSSI, MQTT writes, restart or alarms');
    assert.equal(f.reads.length, enabled ? 1 : 0);
    for (const read of f.reads) {
      assert.equal(read.url, '/gateways/17/read-configuration/mqtt_configuration');
      assert.deepEqual(Object.keys(read.body), []);
    }
    if (enabled) assert(f.get('gatewayMqttObservedValue').children.some(child => child.textContent === 'observed.example.invalid'));
    await f.restore();
    assert.equal(f.reads.length, enabled ? 1 : 0);
    assert.equal(f.posts.length, 0);
    assert.equal(f.get('gatewayRssi').value, -60);
  }
});

test('manual MQTT observation update blocks double clicks and keeps proposal/password separate', async () => {
  const f = await fixture(true); await f.open();
  let done!: () => void;
  f.setRead(() => new Promise(resolve => { done = () => resolve({ status: 'response_observed' }); }));
  f.field('host').value = 'editable-proposal.invalid'; f.field('passwd').value = 'ephemeral-write-secret';
  f.get('gatewayMqttRefreshObservation').listeners.click();
  await new Promise(setImmediate);
  f.get('gatewayMqttRefreshObservation').listeners.click();
  assert.equal(f.reads.length, 2); assert.equal(f.get('gatewayMqttRefreshObservation').disabled, true);
  assert.match(f.get('gatewayMqttReadStatus').textContent, /en curso/);
  assert.match(f.get('gatewayMqttObservedAt').textContent, /Última recepción guardada/);
  done(); await new Promise(setImmediate);
  assert.equal(f.field('host').value, 'editable-proposal.invalid'); assert.equal(f.field('passwd').value, 'ephemeral-write-secret');
  assert.equal(f.posts.length, 0);
});

test('MQTT timeout keeps prior observation dated and blocks blind repeats on reopen', async () => {
  const f = await fixture(true);
  f.setRead(async () => { throw Object.assign(new Error('fictional secret from server'), { status: 504 }); });
  await f.open();
  assert.match(f.get('gatewayMqttReadStatus').textContent, /Timeout/);
  assert.match(f.get('gatewayMqttObservedAt').textContent, /Última recepción guardada/);
  assert.equal(f.get('gatewayMqttRefreshObservation').disabled, true);
  await f.open(); assert.equal(f.reads.length, 1);
  assert.doesNotMatch(f.get('gatewayMqttReadStatus').textContent, /fictional secret/);
});

test('a pending MQTT observation cannot repaint another gateway panel', async () => {
  const f = await fixture(true); let done!: () => void;
  f.setRead(() => new Promise(resolve => { done = () => resolve({ status: 'response_observed' }); }));
  const open = f.open(); await new Promise(setImmediate);
  f.context.gatewayFixture = { ...f.context.gatewayFixture, id: 18, active: false };
  await f.open(); f.get('gatewayMqttReadStatus').textContent = 'Other gateway';
  done(); await open;
  assert.equal(f.get('gatewayMqttReadStatus').textContent, 'Other gateway');
  assert.equal(f.reads.length, 1);
});

test('disabled, malformed and failed observation states do not write or expose untrusted text', async () => {
  const f = await fixture();
  f.setObservation(async () => ({ source: 'observed', correlation: 'unverified', enabled: false, observation: null } as any));
  await f.open(); assert.equal(f.reads.length, 0);
  assert.match(f.get('gatewayMqttReadStatus').textContent, /deshabilitada/);
  f.setObservation(async () => ({ source: 'observed', correlation: 'unverified', enabled: true,
    observation: { observed_at: 'bad', public_value: { ...publicPreset().data, passwd: 'fictional-secret' } } } as any));
  await f.open(); assert.equal(f.reads.length, 0); assert.match(f.get('gatewayMqttReadStatus').textContent, /Error/);
  assert.equal(f.get('gatewayMqttObservedValue').children.length, 0);
  f.setObservation(async () => { throw new Error('fictional-secret'); });
  await f.open(); assert.doesNotMatch(f.get('gatewayMqttReadStatus').textContent, /fictional-secret/);
  assert.equal(f.posts.length, 0);
});
