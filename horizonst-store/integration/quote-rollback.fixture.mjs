import assert from 'node:assert/strict';

// Shared executable contract: Windows offline suite AND Linux runtime container.
export async function verifyQuoteTransactionErrors({express,createQuotesRouter,createAdminQuotesRouter}, selected) {
  const id='11111111-1111-4111-8111-111111111111', results=[];
  for(const role of ['customer','admin'].filter(r=>!selected || r===selected)) {
    for(const scenario of ['rollback_failed','rollback_ok','ordinary_query_error','commit_unknown','early_rollback_failed']) {
      const original=Object.assign(new Error('fictitious original database failure'),{code:scenario==='ordinary_query_error'?'23514':'57P01'});
      const secondary=new Error('fictitious secondary rollback failure');
      let received, sends=0;
      const releases=[],sql=[];
      const quote={id,user_id:id,status:'sent',quote_number:'fixture',email:'fixture@example.invalid',total_cents:100};
      const client={query:async(text)=>{
        sql.push(text);
        if(text==='BEGIN')return{rows:[]};
        if(text==='ROLLBACK') {
          if(scenario==='rollback_failed' || scenario==='early_rollback_failed') throw secondary;
          return{rows:[]};
        }
        if(text==='COMMIT') { if(scenario==='commit_unknown')throw original; return{rows:[]}; }
        if(scenario==='early_rollback_failed')return{rows:[]};
        if(scenario!=='commit_unknown')throw original;
        return{rows:[quote]};
      },release:(destroy)=>{releases.push(!!destroy);}};
      const app=express();app.use(express.json());
      const dependencies={pool:{query:client.query,connect:async()=>client},
        authMiddleware:(req,res,next)=>{req.user={sub:id,role};next();},
        insertQuoteStatusHistory:async()=>id,writeAuditLog:async()=>{},
        createOrderFromAcceptedQuote:async()=>({order:{id},items:[],created:true}),
        insertNotificationIntent:async()=>id,notificationJournal:{dispatch:async()=>{sends++;}}};
      app.get('/alive',(_req,res)=>res.json({alive:true}));
      app.use(role==='customer'?createQuotesRouter(dependencies):createAdminQuotesRouter(dependencies));
      app.use((error,_req,res,_next)=>{received=error;res.status(500).json({error:'database_operation_failed'});});
      const server=app.listen(0);const address=server.address();assert.ok(address && typeof address==='object');
      const url=`http://127.0.0.1:${address.port}`;
      try {
        const response=await fetch(url+(role==='customer'?`/${id}/accept`:`/quotes/${id}/status`),{
          method:role==='customer'?'POST':'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(role==='customer'?{}:{status:'accepted'}),signal:AbortSignal.timeout(2000)});
        assert.equal(response.status,500,`${role}/${scenario}`);
        assert.deepEqual(await response.json(),{error:'database_operation_failed'});
        assert.equal(received,scenario==='early_rollback_failed'?secondary:original);
        assert.deepEqual(releases,[scenario!=='ordinary_query_error']);
        assert.equal(sql.filter(q=>q==='ROLLBACK').length,scenario==='commit_unknown'?0:1);
        assert.equal(sql.filter(q=>q==='COMMIT').length,scenario==='commit_unknown'?1:0);
        assert.equal(sends,0);
        assert.equal((await fetch(url+'/alive')).status,200);
        results.push({role,scenario,passed:true});
      } finally {server.closeAllConnections();await new Promise(r=>server.close(()=>r()));}
    }
  }
  return results;
}
