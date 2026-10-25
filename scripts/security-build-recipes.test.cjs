const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
test('every deployed Node build/runtime base is pinned and its stage has security minimums', () => {
  for (const module of ['backend','cold-compliance-service','horizonst-store','mqtt-ui-api']) {
    const stages=read(module+'/Dockerfile').split(/^FROM /m).slice(1);
    assert.ok(stages.length);
    for (const stage of stages) {
      const base=stage.split('\n')[0].trim();
      if (!base.startsWith('node:')) continue; // named build stage
      assert.match(base,/^node:22\.23\.4-alpine3\.(?:23|24)@sha256:[a-f0-9]{64}(?: AS \w+)?$/);
      for (const pkg of ['ca-certificates>=20261020-r0','ca-certificates-bundle>=20261020-r0','brotli-libs>=1.2.1-r0']) assert.ok(stage.includes(pkg),module+': '+pkg);
    }
  }
});
test('maintained brokers and older Alpine frontends require vendor backports',()=>{
  for (const module of ['vernemq','vernemq-observer']) {
    const source=read(module+'/Dockerfile.maintained');
    assert.match(source,/libbrotli1/);
    assert.match(source,/dpkg --compare-versions/);
    assert.match(source,/1\.1\.0-2\+deb13u1/);
  }
  for (const module of ['portal','mqtt-ui']) assert.match(read(module+'/Dockerfile'),/brotli-libs>=1\.1\.1-r0/);
});
test('Compose gives the 25 second shutdown deadline at least 30 seconds',()=>{
  for (const file of ['docker-compose.yml','infrastructure/production/docker-compose.production.yml']) {
    for (const service of ['app','cold_compliance_service','horizonst_store']) {
      const block=read(file).match(new RegExp('^  '+service+':[^\\n]*\\n((?:(?!^  [\\w-]+:|^\\S)[\\s\\S])*?)(?=^  [\\w-]+:|^\\S|$(?![\\s\\S]))','m'));
      assert.ok(block,service);
      assert.match(block[1],/stop_grace_period: 30s/);
    }
  }
});
test('Brotli fixture uses an owned internal network without published ports or existing volumes',()=>{
  const source=read('infrastructure/security/brotli/verify-candidates.py');
  assert.match(source,/"--internal"/);
  assert.match(source,/uuid\.uuid4/);
  assert.match(source,/\["docker", "rm", "-f", fixture\]/);
  assert.doesNotMatch(source,/"(?:-p|-P|--publish|--env-file|--volumes-from)"/);
});
