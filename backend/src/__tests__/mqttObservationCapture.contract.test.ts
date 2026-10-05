import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

test('RFID demo parser rejects sensitive 2030 before its raw storage fallback, even under a broad subscription', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), '../rfid-demo-dashboard/src/mqtt/parser.ts'), 'utf8');
  const body = source.slice(source.indexOf('export const parseRfidMessage'));
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics?.length, 0);
  const stored: unknown[] = []; const context = { exports: {} as any, normalizeEpc: () => { stored.push('raw'); return 'ABCD'; },
    parseReaderPayload: () => { stored.push('reader'); return []; }, parseSimplePayload: () => { stored.push('simple'); return []; } };
  vm.runInNewContext(compiled.outputText, context);
  for (const text of ['{"msg_id":2030,"data":{"passwd":"fake-sensitive-2030"}}', '{"msg_id":2030,"passwd":"fake-sensitive-2030"']) {
    assert.equal(context.exports.parseRfidMessage(Buffer.from(text)).length, 0);
  }
  assert.deepEqual(stored, []);
});

test('014 preserves previous read contracts and stores exact public fields without password artifacts', () => {
  const sql = fs.readFileSync(path.resolve(process.cwd(), 'migrations/014_gateway_mqtt_observations.sql'), 'utf8');
  for (const id of [2002, 2011, 2030, 2040, 2041, 2057, 2201]) assert.match(sql, new RegExp(`msg_id = ${id}`));
  assert.match(sql, /FOREIGN KEY \(gateway_id, company_id\) REFERENCES gateways\(id, company_id\)/);
  assert.match(sql, /public_value - ARRAY\[/);
  assert.doesNotMatch(sql, /'passwd'|'password'|'password_hash'/);
});
