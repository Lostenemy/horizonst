import assert from 'node:assert/strict';
import { HorizonSTGuard } from '../plugins/horizonst-guard.js';

const hooks = await HorizonSTGuard();
const before = hooks['tool.execute.before'];

const runBash = (command) => before({ tool: 'bash' }, { args: { command } });
const runRead = (filePath) => before({ tool: 'read' }, { args: { filePath } });

const assertBlocked = async (operation, label) => {
  let blocked = false;
  try {
    await operation();
  } catch {
    blocked = true;
  }
  assert.equal(blocked, true, label);
};

const assertAllowed = async (operation, label) => {
  await assert.doesNotReject(operation, label);
};

await assertBlocked(() => runBash('type .env'), 'type .env must be blocked');
await assertBlocked(() => runBash('Get-Content .env'), 'Get-Content .env must be blocked');
await assertBlocked(() => runBash('Get-Content .\\.env'), 'Get-Content .\\.env must be blocked');
await assertBlocked(() => runBash('type horizonst-store\\.env'), 'type nested Windows .env must be blocked');
await assertBlocked(() => runBash('cat horizonst-store/.env'), 'cat nested .env must be blocked');
await assertBlocked(() => runBash('cat .env.local'), 'cat .env.local must be blocked');
await assertBlocked(() => runBash('more .env.production'), 'more .env.production must be blocked');
await assertBlocked(() => runRead('C:/repo/.env.local'), 'read .env.local must be blocked');
await assertBlocked(() => runRead('C:/repo/private.pem'), 'read .pem must be blocked');

await assertAllowed(() => runBash('type .env.example'), 'type .env.example must be allowed');
await assertAllowed(() => runBash('Get-Content config.env.example'), 'config.env.example must be allowed');
await assertAllowed(() => runRead('C:/repo/.env.example'), 'read .env.example must be allowed');
await assertAllowed(() => runBash('echo revisar .env en documentacion'), 'descriptive echo must be allowed');

console.log('horizonst guard tests passed');
