import express from 'express';
import assert from 'node:assert/strict';
import { createQuotesRouter } from '../src/modules/quotes/quotes.routes.js';
import { createAdminQuotesRouter } from '../src/modules/admin/quotes.routes.js';
import { verifyQuoteTransactionErrors } from '../integration/quote-rollback.fixture.mjs';
import { runNotificationMigration } from '../src/db/migrate-notifications.js';
import { createNotificationsRouter } from '../src/modules/shared/notifications.routes.js';

await verifyQuoteTransactionErrors({express,createQuotesRouter,createAdminQuotesRouter},process.env.QUOTE_ROLLBACK_TEST_ROLE);
{
  const original=Object.assign(new Error('fictitious original'),{code:'57P01'}),releases:boolean[]=[];
  const client={query:async(sql:string)=>{if(sql==='BEGIN')return{rows:[]};throw sql==='ROLLBACK'?new Error('secondary'):original;},release:(destroy?:boolean)=>{releases.push(!!destroy);}};
  await assert.rejects(runNotificationMigration({connect:async()=>client} as any),error=>error===original);
  assert.deepEqual(releases,[true]);
}
for(const operation of ['cancel','review']) {
  const id='11111111-1111-4111-8111-111111111111',releases:boolean[]=[];
  const client={query:async(sql:string)=>{if(sql==='BEGIN')return{rows:[]};throw new Error(sql==='ROLLBACK'?'secondary':'original');},release:(destroy?:boolean)=>{releases.push(!!destroy);}};
  const app=express();app.use(express.json());
  app.use(createNotificationsRouter({connect:async()=>client} as any,(req,res,next)=>{req.user={sub:id,role:'admin'} as any;next();}));
  const server=app.listen(0);const address=server.address();assert.ok(address && typeof address==='object');
  try {
    const response=await fetch(`http://127.0.0.1:${address.port}/admin/notifications/${id}/${operation}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:'acknowledge_no_resend'})});
    assert.equal(response.status,503);assert.deepEqual(releases,[true]);
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
