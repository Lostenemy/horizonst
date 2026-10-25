import assert from 'node:assert/strict';
import { NotificationJournal, journalConnection, insertNotificationIntent } from '../src/modules/shared/notification-journal.js';
import { ServiceLifecycle } from '../src/lifecycle.js';
import express from 'express';
import { createQuotesRouter } from '../src/modules/quotes/quotes.routes.js';
import { createAdminQuotesRouter } from '../src/modules/admin/quotes.routes.js';

// No database/network. Public SMTP outcome proof is tested separately with a real fictitious peer.
const outcomes = [
  { state: 'smtp_accepted', resultCode: 'accepted', smtpCode: 250 },
  { state: 'rejected_temporary', resultCode: 'smtp_rejected', smtpCode: 451 },
  { state: 'rejected_permanent', resultCode: 'smtp_rejected', smtpCode: 550 },
  { state: 'uncertain', resultCode: 'transport_uncertain' },
  { state: 'failed_before_send', resultCode: 'before_data' }
] as const;
for (const outcome of outcomes) {
  const calls: any[] = []; let sends = 0, releases = 0;
  const journal = new NotificationJournal({ connect: async () => ({
    query: async (sql, values) => { calls.push({ sql, values }); return { rows: sql.includes('RETURNING d.id') ? [{ id: 'id' }] : [] }; },
    release: () => { releases++; }
  }) }, new ServiceLifecycle(), () => true);
  await journal.dispatch('11111111-1111-4111-8111-111111111111', async () => { sends++; assert.equal(calls.length, 1); return outcome; });
  assert.equal(sends, 1); assert.equal(releases, 2);
  assert.equal(calls[1].values[2], outcome.state); assert.match(calls[1].sql, /attempt_id=\$2::uuid AND state='dispatching'/);
  assert.match(calls[1].sql, /lease_until>clock_timestamp/);
  await journal.recover(); assert.match(calls[2].sql, /state='uncertain'/);
  assert.doesNotMatch(calls[2].sql, /SET state='pending'/);
}
{
  let sends = 0;
  const stopped = new ServiceLifecycle(); stopped.stopping = true;
  const noDb = { connect: async () => { throw new Error('must not connect'); } };
  await new NotificationJournal(noDb, stopped, () => true).dispatch('id', async () => { sends++; });
  await new NotificationJournal(noDb, new ServiceLifecycle(), () => false).dispatch('id', async () => { sends++; });
  assert.equal(sends, 0);
}
{
  let release!: (c: any) => void, releases = 0;
  const p = journalConnection({ connect: () => new Promise(r => { release = r; }) }, async () => { throw new Error('late work forbidden'); }, 5);
  await assert.rejects(p, /notification_database_deadline/);
  release({ release: (destroy: boolean) => { assert.equal(destroy, true); releases++; } });
  await new Promise(r => setImmediate(r)); assert.equal(releases, 1);
}
{
  let releases = 0;
  await assert.rejects(journalConnection({ connect: async () => ({
    query: async () => new Promise(() => {}), release: (destroy: boolean) => { assert.equal(destroy, true); releases++; }
  }) }, c => c.query('blocked'), 5), /notification_database_deadline/);
  assert.equal(releases, 1);
}
await assert.rejects(insertNotificationIntent({ query: async () => ({ rows: [] }) }, { historyId: 'missing', type: 'quote_available' }), /notification_intent_not_created/);
{
  let claims = 0, sends = 0;
  const finish: Array<() => void> = [];
  const db = { connect: async () => ({ query: async (sql: string) => {
    if (sql.includes('RETURNING d.id')) { claims++; return { rows: [{ id: 'id' }] }; } return { rows: [] };
  }, release: () => {} }) };
  const journal = new NotificationJournal(db, new ServiceLifecycle(), () => true);
  const work = Array.from({ length: 5 }, () => journal.dispatch('id', () => {
    sends++; return new Promise(resolve => finish.push(() => resolve({ state: 'smtp_accepted', resultCode: 'accepted', smtpCode: 250 })));
  }));
  await new Promise(r => setImmediate(r)); assert.equal(claims, 4); assert.equal(sends, 4);
  for (const resolve of finish) resolve(); await Promise.all(work);
}
for (const admin of [false,true]) {
  const app=express();app.use(express.json());
  const db={query:async()=>({rows:[]}),connect:async()=>{throw new Error('fictitious connection unavailable');}};
  const dependencies={pool:db,authMiddleware:(req:any,res:any,next:any)=>{req.user={sub:'11111111-1111-4111-8111-111111111111',role:admin?'admin':'customer'};next();}};
  app.use(admin?createAdminQuotesRouter(dependencies):createQuotesRouter(dependencies));
  const server=app.listen(0);const address=server.address();assert.ok(address && typeof address==='object');
  try {
    const response=await fetch(`http://127.0.0.1:${address.port}/`+(admin?'quotes/11111111-1111-4111-8111-111111111111/status':'11111111-1111-4111-8111-111111111111/accept'),{
      method:admin?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(admin?{status:'accepted'}:{})});
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'notification_database_unavailable'});
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
