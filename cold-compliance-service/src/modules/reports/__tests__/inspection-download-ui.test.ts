import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

test('PDF and Excel use freshly edited filters on every click without redrawing reports', async () => {
  const source = readFileSync(path.resolve(process.cwd(), 'web/app.js'), 'utf8');
  const requests: Array<{ url: string; authorization: string; pendingLabel: string }> = [];
  const downloads: string[] = [];
  const elements: Record<string, { value: string; innerHTML: string }> = {};
  const context = vm.createContext({
    localStorage: { getItem: () => '' },
    document: {
      getElementById: (id: string) => id === 'toastStack' ? null :
        (elements[id] ||= { value: '', innerHTML: '' }),
      createElement: () => ({ href: '', download: '', click() { downloads.push(this.download); } })
    },
    URLSearchParams,
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
    fetch: async (url: string, options: { headers: { Authorization: string } }) => {
      requests.push({ url, authorization: options.headers.Authorization, pendingLabel: context.button.textContent });
      return { ok: true, blob: async () => ({}) };
    },
    console
  });
  vm.runInContext(source.slice(0, source.indexOf('(function wireLoginForm()')), context);
  vm.runInContext("token = 'fixture-session'; currentUser = { role: 'supervisor' }", context);
  await vm.runInContext('renderReports()', context);
  const rendered = elements.reports.innerHTML;
  assert.doesNotMatch(rendered, /Actualizar filtros|Periodo seleccionado/);

  async function click(format: 'pdf' | 'excel'): Promise<void> {
    const cssClass = format === 'pdf' ? 'pdf' : 'excel';
    const handler = rendered.match(new RegExp(`class="report-btn report-btn-${cssClass}" onclick="([^"]+)"`))?.[1];
    assert.ok(handler);
    context.button = { textContent: `Descargar ${format}`, disabled: false };
    await vm.runInContext(handler.replace(/\bthis\b/, 'button'), context);
    assert.equal(context.button.textContent, `Descargar ${format}`);
    assert.equal(context.button.disabled, false);
    assert.equal(elements.reports.innerHTML, rendered);
  }

  elements.rFrom.value = '2026-09-01';
  elements.rTo.value = '2026-09-15';
  elements.rWorker.value = 'AB 12/Ñ+&';
  await click('pdf');
  assert.equal(requests[0].url,
    '/reports/inspection.pdf?from=2026-09-01&to=2026-09-15&workerDni=AB+12%2F%C3%91%2B%26');

  elements.rFrom.value = '2026-09-16';
  elements.rTo.value = '';
  elements.rWorker.value = '  12345678A  ';
  await click('excel');
  assert.equal(requests[1].url, '/reports/inspection.xlsx?from=2026-09-16&workerDni=12345678A');
  assert.notEqual(requests[0].url, requests[1].url);

  elements.rFrom.value = '';
  elements.rTo.value = '';
  elements.rWorker.value = '  ';
  await click('pdf');
  await click('excel');
  assert.deepEqual(requests.map(({ url }) => url).slice(2),
    ['/reports/inspection.pdf', '/reports/inspection.xlsx']);
  assert.deepEqual(downloads, ['inspection.pdf', 'inspection.xlsx', 'inspection.pdf', 'inspection.xlsx']);
  assert.ok(requests.every(({ authorization, pendingLabel }) =>
    authorization === 'Bearer fixture-session' && pendingLabel === 'Generando...'));
});
