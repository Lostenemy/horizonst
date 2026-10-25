import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { waitForStablePostgres } from '../production/tests/postgres-container-lifecycle.mjs';

assert.ok(process.argv.includes('--run-disposable-docker'), 'Explicit disposable opt-in required');
const root = path.resolve(import.meta.dirname, '../..');
const evidence = mkdtempSync(path.join(tmpdir(), 'horizonst-smtp-journal-'));
const prefix = 'horizonst-smtp-' + randomUUID().replaceAll('-', '');
const password = randomBytes(32).toString('hex'), jwt = randomBytes(48).toString('hex'), smtpSecret = randomBytes(32).toString('hex');
const owned = [], results = [], cleanup = [];
let network, failure, seq = 0;
const redact = value => [password,jwt,smtpSecret,Buffer.from(smtpSecret).toString('base64')].reduce((s, secret) => s.replaceAll(secret, '[REDACTED]'), String(value));
function docker(args, options = {}) {
  const r = spawnSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 16*1024*1024, windowsHide: true, ...options });
  if (r.status !== 0) {
    writeFileSync(path.join(evidence, `failed-${++seq}.log`), redact((r.stdout || '') + (r.stderr || '')));
    throw new Error(`isolated_docker_${args[0]}_failed`);
  }
  return r.stdout + (['build','logs'].includes(args[0]) ? r.stderr : '');
}
function create(name, args, fixture = false) {
  const id = docker(['create', '--name', name, ...args]).trim();
  assert.match(id, /^[a-f0-9]{64}$/); owned.push(id);
  if (fixture) docker(['cp', 'infrastructure/testing/smtp-journal.fixture.mjs', `${id}:/tmp/smtp-journal.fixture.mjs`]);
  docker(['start', id]); return id;
}
const inspect = id => JSON.parse(docker(['inspect','--format','{{json .State}}',id]));
const sql = (id, text) => docker(['exec','-i',id,'psql','-X','-v','ON_ERROR_STOP=1','-At','-U','fixture','-d','store','-f','-'], { input: text });
async function until(check, ms = 60_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (check()) return; await sleep(200); }
  throw new Error('isolated_smtp_scenario_deadline');
}
function args(extra = []) {
  return ['--network',network,'-e','NODE_ENV=production','-e','DB_HOST=pg','-e','DB_USER=fixture',
    '-e',`DB_PASSWORD=${password}`,'-e','DB_NAME=store','-e',`STORE_JWT_SECRET=${jwt}`,
    '-e','STORE_MAIL_ENABLED=true','-e','STORE_MAIL_HOST=smtp','-e','STORE_MAIL_PORT=2525','-e','STORE_MAIL_SECURE=false',
    '-e','STORE_MAIL_USER=fixture-smtp','-e',`STORE_MAIL_PASSWORD=${smtpSecret}`,
    '-e','STORE_MAIL_FROM=sender@example.invalid','-e','STORE_MAIL_COMMERCIAL_TO=commercial@example.invalid',
    ...extra,`${prefix}-store`];
}
const queryPeer = (id, mode) => JSON.parse(docker(['exec',id,'node','-e',
  `fetch('http://smtp:2526/${mode ? '?mode='+mode : ''}').then(r=>r.json()).then(x=>console.log(JSON.stringify(x)))`]));
async function completed(id, label) {
  await until(() => !inspect(id).Running, 90_000);
  const state = inspect(id), logs = docker(['logs',id]);
  writeFileSync(path.join(evidence,label+'.log'),redact(logs));
  assert.equal(state.ExitCode,0,label); assert.equal(state.OOMKilled,false);
  return logs;
}
const versions = {};
try {
  console.log(JSON.stringify({ phase:'build', evidence }));
  versions.docker = docker(['version','--format','{{.Server.Version}}']).trim();
  writeFileSync(path.join(evidence,'build.log'),redact(docker(['build','-f','infrastructure/testing/lifecycle.Dockerfile','--target','store','-t',`${prefix}-store`,'.'],{ timeout:600_000 })));
  versions.image = docker(['image','inspect','--format','{{.Id}}',`${prefix}-store`]).trim();
  network = docker(['network','create','--internal',prefix]).trim();
  const pg = create(prefix+'-pg',['--network',network,'--network-alias','pg','--tmpfs','/var/lib/postgresql/data:rw,size=256m',
    '-e','PGDATA=/var/lib/postgresql/journal-data','-e','POSTGRES_USER=fixture','-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=store','postgres:15-alpine']);
  waitForStablePostgres({ readLogs:()=>docker(['logs','--tail','80',pg]), probeSql:()=>{try{return sql(pg,'SELECT 1').trim()==='1';}catch{return false;}},timeoutMs:60_000,redactValues:[password] });
  versions.postgres = sql(pg,"SELECT current_setting('server_version')").trim(); assert.match(versions.postgres,/^15\./);
  // Real existing-base shape: only commercial 001–010. Do not apply 011–015 just to reach the journal.
  sql(pg, 'CREATE SCHEMA store; CREATE TABLE store.schema_migrations(filename text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());');
  for (const filename of readdirSync(path.join(root,'horizonst-store/migrations')).filter(n=>/^0(?:0\d|10)_.*\.sql$/.test(n)).sort()) {
    sql(pg, 'BEGIN;\n'+readFileSync(path.join(root,'horizonst-store/migrations',filename),'utf8')+`\nINSERT INTO store.schema_migrations(filename) VALUES('${filename}'); COMMIT;`);
  }
  const migration = create(prefix+'-migration', [...args(), 'node','dist/db/migrate-notifications.js']);
  await completed(migration,'migration');
  assert.equal(sql(pg,'SELECT count(*) FROM store.schema_migrations').trim(),'10');
  assert.equal(sql(pg,"SELECT count(*) FROM store.notification_migrations WHERE filename='017_notification_deliveries.sql'").trim(),'1');
  const peer = create(prefix+'-smtp',[...args(['--network-alias','smtp']),'node','/tmp/smtp-journal.fixture.mjs','--peer'],true);
  await until(()=>{try{return queryPeer(peer).mode==='success';}catch{return false;}});
  for(let round=1;round<=3;round++) {
    console.log(JSON.stringify({ phase:'protocol-and-database',round,evidence }));
    const cases = create(prefix+'-cases-'+round,[...args(),'node','/tmp/smtp-journal.fixture.mjs'],true);
    const log = await completed(cases,'cases-'+round);
    const data = JSON.parse(log.split(/\r?\n/).find(line=>line.startsWith('{"runtime":'))); assert.equal(data.runtime,'v22.23.4');
    results.push({ round, ...data });
  }
  for(let round=1;round<=3;round++) {
    for (const databaseDown of [false,true]) {
      console.log(JSON.stringify({ phase:'runtime-stop',round,databaseDown,evidence }));
      const app = create(`${prefix}-application-${round}-${databaseDown}`,args(['--network-alias','application']));
      await until(()=>{try{return docker(['exec',app,'node','-e',"fetch('http://127.0.0.1:4020/health').then(r=>console.log(r.status))"]).trim()==='200';}catch{return false;}});
      assert.match(docker(['exec',app,'node','-e',"console.log(require('fs').readFileSync('/proc/1/cmdline','utf8').split('\\0')[0])"]),/node/);
      queryPeer(peer,'timeout'); const count = queryPeer(peer).received;
      const trigger = create(`${prefix}-trigger-${round}-${databaseDown}`,[...args(),'node','/tmp/smtp-journal.fixture.mjs','--trigger'],true);
      const response = await completed(trigger,`trigger-${round}-${databaseDown}`);
      const q = JSON.parse(response.trim().split(/\r?\n/).at(-1)).quoteId;
      await until(()=>queryPeer(peer).received===count+1);
      if(databaseDown) docker(['stop','--time','5',pg]);
      const started=Date.now(); docker(['kill','--signal=TERM',app]);
      try { docker(['kill','--signal=TERM',app]); } catch { assert.equal(inspect(app).Running,false); }
      await completed(app,`shutdown-${round}-${databaseDown}`);
      const elapsedMs=Date.now()-started;
      assert.ok(elapsedMs<28_000); assert.equal(inspect(app).ExitCode,0);
      results.push({ round,scenario:'smtp-inflight-stop',databaseDown,elapsedMs,exitCode:0 });
      if(databaseDown) {
        docker(['start',pg]); await until(()=>{try{return sql(pg,'SELECT 1').trim()==='1';}catch{return false;}});
      }
      const restart=create(`${prefix}-recovery-${round}-${databaseDown}`,args());
      await until(()=>sql(pg,`SELECT d.state FROM store.notification_deliveries d JOIN store.quote_status_history h ON h.id=d.status_history_id WHERE h.quote_id='${q}'`).trim()==='uncertain',40_000);
      assert.equal(queryPeer(peer).received,count+1,'restart must not resend uncertain notification');
      docker(['kill','--signal=TERM',restart]); await completed(restart,`restart-${round}-${databaseDown}`);
      results.push({ round,scenario:'restart-recovery-no-resend',databaseDown,passed:true });
    }
  }
} catch (error) { failure = error; console.error(error.message); }
finally {
  for (const id of owned.reverse()) {
    try { docker(['rm','-f',id]); cleanup.push({id,removed:true}); } catch { cleanup.push({id,removed:false}); }
  }
  if(network) try {docker(['network','rm',network]);cleanup.push({network,removed:true});}catch{cleanup.push({network,removed:false});}
  const result={status:failure?'failed':'passed',evidence,versions,results,cleanup,error:failure?.message};
  writeFileSync(path.join(evidence,'results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({status:result.status,evidence,groups:results.length}));
  if(failure || cleanup.some(c=>!c.removed)) process.exitCode=1;
}
