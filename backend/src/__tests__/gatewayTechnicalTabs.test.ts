import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

test('technical tabs support clicks, arrow keys and one visible panel without commands', () => {
  class Tab {
    attributes: Record<string, string> = {}; listeners: Record<string, (event: any) => void> = {}; tabIndex = -1; focused = false;
    constructor(public id: string) {}
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    addEventListener(name: string, callback: (event: any) => void) { this.listeners[name] = callback; }
    focus() { this.focused = true; }
  }
  const tabs = ['a', 'b', 'c'].map(id => new Tab(id));
  const panels = tabs.map(tab => ({ dataset: { gatewayTabPanel: tab.id }, hidden: false }));
  const document = { querySelectorAll: (selector: string) => selector.startsWith('.gateway-tabs') ? tabs : panels };
  const js = readFileSync(path.resolve('public/js/gateways.js'), 'utf8');
  const start = js.indexOf('const gatewayTabs =');
  const end = js.indexOf('const formatType =', start);
  assert(start >= 0 && end > start);
  vm.runInNewContext(js.slice(start, end), { document });
  tabs[1].listeners.click({});
  assert.deepEqual(panels.map(panel => panel.hidden), [true, false, true]);
  assert.equal(tabs[1].attributes['aria-selected'], 'true');
  assert.equal(tabs[1].tabIndex, 0);
  let prevented = false;
  tabs[1].listeners.keydown({ key: 'End', preventDefault: () => { prevented = true; } });
  assert(prevented);
  assert.deepEqual(panels.map(panel => panel.hidden), [true, true, false]);
  assert.equal(tabs[2].focused, true);
  tabs[2].listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.deepEqual(panels.map(panel => panel.hidden), [false, true, true]);
  assert.equal(tabs[0].focused, true);
});

test('technical tab markup has a named tablist and only the initial panel visible', () => {
  const html = readFileSync(path.resolve('public/gateways.html'), 'utf8');
  assert.match(html, /role="tablist" aria-label="Utilidades de la gateway"/);
  const panels = [...html.matchAll(/<section role="tabpanel"[^>]*>/g)].map(match => match[0]);
  assert.equal(panels.length, 5);
  assert.equal(panels.filter(panel => /\shidden(?:\s|>)/.test(panel)).length, 4);
  assert(panels.every(panel => /aria-labelledby="gatewayTab/.test(panel)));
  assert.equal((html.match(/role="tab"/g) ?? []).length, 5);
});
