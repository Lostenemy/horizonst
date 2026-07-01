import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '../src/db/migrate.js';

const directory = await mkdtemp(path.join(tmpdir(), 'horizonst-migrations-'));
await writeFile(path.join(directory, '001_first.sql'), 'CREATE TABLE store.example (id UUID);');
await writeFile(path.join(directory, '002_second.sql'), 'ALTER TABLE store.example ADD COLUMN name TEXT;');

const events: string[] = [];
let clientId = 0;
const pool = {
  async query(sql: string) {
    events.push(`pool:${sql.split('\n')[0]}`);
    return { rowCount: sql.startsWith('SELECT 1') ? 0 : 1 };
  },
  async connect() {
    const id = `client-${++clientId}`;
    events.push(`${id}:connect`);
    return {
      async query(sql: string) {
        events.push(`${id}:${sql.split('\n')[0]}`);
        return { rowCount: 1 };
      },
      release() {
        events.push(`${id}:release`);
      }
    };
  }
};

await runMigrations(pool, directory);

assert.equal(clientId, 2);
assert.deepEqual(events.slice(0, 2), [
  'pool:CREATE SCHEMA IF NOT EXISTS store',
  'pool:CREATE TABLE IF NOT EXISTS store.schema_migrations ('
]);
assert.ok(events.includes('pool:SELECT 1 FROM store.schema_migrations WHERE filename = $1'));
for (const id of ['client-1', 'client-2']) {
  const begin = events.indexOf(`${id}:BEGIN`);
  const migrationSql = events.findIndex((event) => event.startsWith(`${id}:CREATE`) || event.startsWith(`${id}:ALTER`));
  const insert = events.indexOf(`${id}:INSERT INTO store.schema_migrations (filename) VALUES ($1)`);
  const commit = events.indexOf(`${id}:COMMIT`);
  const release = events.indexOf(`${id}:release`);
  assert.ok(begin >= 0, `${id} begins the transaction`);
  assert.ok(migrationSql > begin, `${id} runs migration SQL after BEGIN`);
  assert.ok(insert > migrationSql, `${id} records schema migration after SQL`);
  assert.ok(commit > insert, `${id} commits after the migration record`);
  assert.ok(release > commit, `${id} releases after COMMIT`);
}
assert.equal(events.some((event) => event === 'pool:BEGIN' || event === 'pool:COMMIT' || event === 'pool:ROLLBACK'), false);
