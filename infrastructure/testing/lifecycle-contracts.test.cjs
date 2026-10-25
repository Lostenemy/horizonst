'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');

test('three lifecycle implementations are identical and runtime entrypoints install shutdown', () => {
  const files = ['backend', 'cold-compliance-service', 'horizonst-store'];
  const sources = files.map(file => fs.readFileSync(path.join(root, file, 'src/lifecycle.ts'), 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(sources[0], sources[1]); assert.equal(sources[0], sources[2]);
  for (const service of files) {
    const entry = service === 'horizonst-store' ? 'server.ts' : 'index.ts';
    assert.match(fs.readFileSync(path.join(root, service, 'src', entry), 'utf8'), /lifecycle\.install\(/);
    assert.match(fs.readFileSync(path.join(root, service, 'src/db/pool.ts'), 'utf8'), /connectionTimeoutMillis: 2_000/);
  }
});

test('container validation is opt-in, isolated, has no published ports and cleanup uses acquired IDs only', () => {
  const source = fs.readFileSync(path.join(__dirname, 'lifecycle-docker.mjs'), 'utf8');
  assert.match(source, /--run-disposable-docker/);
  assert.match(source, /'network', 'create', '--internal'/);
  assert.match(source, /owned\.push\(id\)/);
  assert.match(source, /\['rm', '-f', id\]/);
  assert.doesNotMatch(source, /['"](?:-p|-P|--publish|--publish-all|--env-file|--volumes-from)['"]|docker compose/);
  assert.match(source, /'--tmpfs'/);
  const docker = fs.readFileSync(path.join(__dirname, 'lifecycle.Dockerfile'), 'utf8');
  assert.equal((docker.match(/CMD \["node"/g) || []).length, 3);
  assert.doesNotMatch(docker, /CMD \["npm"/);
});

test('SMTP journal isolation, privacy and no automatic replay contracts', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const harness = read('infrastructure/testing/smtp-journal-docker.mjs');
  assert.match(harness, /--run-disposable-docker/);
  assert.match(harness, /'network','create','--internal'/);
  assert.match(harness, /owned\.push\(id\)/);
  assert.match(harness, /\['rm','-f',id\]/);
  assert.doesNotMatch(harness, /['"](?:-p|-P|--publish|--publish-all|--env-file|--volumes-from)['"]|docker compose/);
  assert.match(harness, /randomBytes\(32\)/);
  const journal = read('horizonst-store/src/modules/shared/notification-journal.ts');
  assert.match(read('horizonst-store/src/modules/shared/mail.ts'), /budgetMs = 15_000/);
  assert.match(journal, /budgetMs = 2000/);
  assert.match(journal, /state='pending' FOR UPDATE SKIP LOCKED/);
  assert.match(journal, /attempt_id=\$2::uuid AND state='dispatching'/);
  const recover = journal.slice(journal.indexOf('recover():'), journal.indexOf('dispatch(id:'));
  assert.doesNotMatch(recover, /deliver\(|SET state='pending'/);
  const migration = read('horizonst-store/migrations/017_notification_deliveries.sql');
  assert.doesNotMatch(migration, /ON DELETE CASCADE|\b(?:body|password|recipient_email|payload)\s+(?:TEXT|JSONB)/i);
  for (const name of ['quotes/quotes.routes.ts','admin/quotes.routes.ts']) {
    const source = read('horizonst-store/src/modules/' + name);
    assert.ok(source.indexOf('await insertIntent(') < source.indexOf("await client.query('COMMIT')"));
    assert.ok(source.indexOf('void journal.dispatch(') > source.indexOf("await client.query('COMMIT')"));
    assert.doesNotMatch(source, /console\.(?:error|warn).*\bto\b/);
  }
});
