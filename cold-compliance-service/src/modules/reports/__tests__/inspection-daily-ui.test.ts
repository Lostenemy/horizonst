import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

test('la lista usa filtros actuales, autorización, estados accesibles y no borra filtros', async () => {
  const source = readFileSync(path.resolve(process.cwd(), 'web/app.js'), 'utf8');
  const requests: string[] = [];
  const attributes: Record<string, string> = {};
  const button = { disabled: false };
  const elements: Record<string, any> = {
    reports: { innerHTML: '', querySelector: () => button },
    reportDailyResults: { innerHTML: '', setAttribute: (key: string, value: string) => { attributes[key] = value; } }
  };
  let mode: 'success' | 'empty' | 'error' | 'pending' = 'success';
  let releasePending: ((value: any) => void) | undefined;
  const context = vm.createContext({
    localStorage: { getItem: () => '' },
    document: { getElementById: (id: string) => elements[id] ||= { value: '', innerHTML: '' } },
    URLSearchParams,
    fetch: async (url: string, options: { headers: { Authorization: string } }) => {
      assert.equal(options.headers.Authorization, 'Bearer fixture-session');
      requests.push(url);
      if (mode === 'pending') return new Promise((resolve) => { releasePending = resolve; });
      if (mode === 'error') return { ok: false };
      return { ok: true, json: async () => ({ rows: mode === 'empty' ? [] : [{ workday_date: '2026-09-25',
        full_name: '<script>Nombre</script>', dni: 'AB 12/Ñ+&', accumulated_seconds: 3700 }] }) };
    },
    console
  });
  vm.runInContext(source.slice(0, source.indexOf('(function wireLoginForm()')), context);
  vm.runInContext("token = 'fixture-session'; currentUser = { role: 'supervisor' }", context);
  await vm.runInContext('renderReports()', context);
  const rendered = elements.reports.innerHTML;
  assert.match(rendered, /Ver acumulado por jornada/);
  assert.match(rendered, /id="reportDailyResults"[^>]+aria-live="polite"/);
  const click = () => vm.runInContext('viewDailyAccumulation(button)', Object.assign(context, { button }));

  elements.rFrom.value = '2026-09-25'; elements.rTo.value = '2026-09-26';
  elements.rWorker.value = 'AB 12/Ñ+&';
  await click();
  assert.equal(requests[0], '/reports/inspection/daily?from=2026-09-25&to=2026-09-26&workerDni=AB+12%2F%C3%91%2B%26');
  assert.match(elements.reportDailyResults.innerHTML, /2026-09-25/);
  assert.match(elements.reportDailyResults.innerHTML, /1h 01m 40s/);
  assert.doesNotMatch(elements.reportDailyResults.innerHTML, /<script>/);
  assert.match(elements.reportDailyResults.innerHTML, /&lt;script&gt;Nombre/);
  assert.equal(button.disabled, false);

  elements.rFrom.value = ''; elements.rTo.value = ''; elements.rWorker.value = '';
  vm.runInContext('reportFiltersChanged()', context);
  assert.match(elements.reportDailyResults.innerHTML, /Filtros modificados/);
  mode = 'empty'; await click();
  assert.equal(requests[1], '/reports/inspection/daily');
  assert.match(elements.reportDailyResults.innerHTML, /No hay jornadas/);
  assert.equal(elements.rFrom.value, '');

  mode = 'error'; await click();
  assert.match(elements.reportDailyResults.innerHTML, /role="alert"/);
  assert.equal(button.disabled, false);
  assert.equal(elements.rWorker.value, '');
  assert.equal(elements.reports.innerHTML, rendered);
  assert.equal(attributes['aria-busy'], 'false');

  mode = 'pending'; elements.rFrom.value = '2026-09-01';
  const pending = click();
  assert.match(elements.reportDailyResults.innerHTML, /Cargando acumulados/);
  assert.equal(button.disabled, true);
  elements.rFrom.value = '2026-09-30'; vm.runInContext('reportFiltersChanged()', context);
  assert.equal(button.disabled, false);
  releasePending!({ ok: true, json: async () => ({ rows: [{ workday_date: '2026-09-01' }] }) });
  await pending;
  assert.doesNotMatch(elements.reportDailyResults.innerHTML, /2026-09-01/);
  assert.match(elements.reportDailyResults.innerHTML, /Filtros modificados/);
  assert.equal(elements.rFrom.value, '2026-09-30');
});
