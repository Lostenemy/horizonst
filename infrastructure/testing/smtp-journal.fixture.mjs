// Runs ONLY inside the harness-owned Linux Store container; no external hosts/credentials.
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

if (process.argv.includes('--peer')) {
  let mode = 'success', received = 0;
  const sockets = new Set();
  net.createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    if (mode === 'before') { socket.destroy(); return; }
    socket.write('220 fictitious SMTP\r\n');
    let buffer = '', data = false, auth = 0;
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (data) {
        if (!buffer.endsWith('\r\n.\r\n')) return;
        received++; buffer = ''; data = false;
        if (mode === 'uncertain') { socket.destroy(); return; }
        if (mode === 'timeout') return;
        if (mode === 'accepted_close') socket.end('250 accepted by fictitious SMTP only\r\n');
        else socket.write('250 accepted by fictitious SMTP only\r\n'); return;
      }
      while (buffer.includes('\r\n')) {
        const i = buffer.indexOf('\r\n'), line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        if (auth) { socket.write(auth === 1 ? '334 Password\r\n' : '235 authenticated\r\n'); auth = auth === 1 ? 2 : 0; }
        else if (line.startsWith('EHLO')) socket.write('250 fake\r\n');
        else if (line === 'AUTH LOGIN') { auth = 1; socket.write('334 User\r\n'); }
        else if (line.startsWith('MAIL FROM')) socket.write('250 ok\r\n');
        else if (line.startsWith('RCPT TO')) socket.write(mode === 'temporary' ? '451 temporary fictitious rejection\r\n' : mode === 'permanent' ? '550 permanent fictitious rejection\r\n' : '250 ok\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 proceed\r\n'); }
        else if (line === 'QUIT') socket.destroy();
      }
    });
  }).listen(2525, '0.0.0.0');
  http.createServer((req, res) => {
    const next = new URL(req.url, 'http://fixture').searchParams.get('mode');
    if (next) { assert.ok(['success','accepted_close','before','temporary','permanent','uncertain','timeout'].includes(next)); mode = next; }
    res.end(JSON.stringify({ received, mode }));
  }).listen(2526, '0.0.0.0');
} else {
  const { pool, closePool } = await import('/app/dist/db/pool.js');
  const { env } = await import('/app/dist/config/env.js');
  const { deliverNotificationMail, SmtpClient } = await import('/app/dist/modules/shared/mail.js');
  const { NotificationJournal, insertNotificationIntent } = await import('/app/dist/modules/shared/notification-journal.js');
  const { ServiceLifecycle } = await import('/app/dist/lifecycle.js');
  const { insertQuoteStatusHistory } = await import('/app/dist/modules/admin/quotes/history.js');
  const { runNotificationMigration } = await import('/app/dist/db/migrate-notifications.js');
  const { signAccessToken, credentialVersion } = await import('/app/dist/modules/auth/token.js');
  const peer = async mode => (await fetch('http://smtp:2526/' + (mode ? '?mode=' + mode : ''))).json();
  const owner = randomUUID(), other = randomUUID(), passwordHash = randomBytes(32).toString('hex');
  const scalar = async (sql, values) => (await pool.query(sql, values)).rows[0];
  const user = async id => pool.query("INSERT INTO store.users(id,email,password_hash,full_name,role,status) VALUES($1,$2,$3,'Fixture','admin','active')", [id, `${id}@example.invalid`, passwordHash]);
  await user(owner); await user(other);
  const quote = async () => {
    const id = randomUUID();
    await pool.query("INSERT INTO store.quotes(id,user_id,quote_number,status,subtotal_cents,discount_cents,tax_cents,total_cents) VALUES($1,$2,$3,'in_review',100,0,21,121)", [id, owner, id]); return id;
  };
  const intent = async (commit = true) => {
    const q = await quote(), c = await pool.connect();
    try {
      await c.query('BEGIN');
      const h = await insertQuoteStatusHistory({ quoteId: q, oldStatus: 'in_review', newStatus: 'sent', changedBy: owner }, c);
      const id = await insertNotificationIntent(c, { historyId: h, type: 'quote_available' });
      await c.query(commit ? 'COMMIT' : 'ROLLBACK'); return { id, q, h };
    } finally { c.release(); }
  };
  const row = id => scalar('SELECT state,attempt_id,result_code,smtp_code FROM store.notification_deliveries WHERE id=$1', [id]);
  const content = { to: 'recipient@example.invalid', subject: 'fictitious', text: 'test-only', html: '<p>test-only</p>' };
  const deliver = (ms = 1000) => deliverNotificationMail(content, new SmtpClient(env.mail), ms);
  const journal = () => new NotificationJournal(pool, new ServiceLifecycle(), () => true);
  const results = [];
  async function check(name, test) { await test(); results.push({ name, passed: true }); }
  try {
    if (process.argv.includes('--trigger')) {
      const q = await quote();
      const token = signAccessToken({ sub: owner, email: `${owner}@example.invalid`, role: 'admin', status: 'active', credentialVersion: credentialVersion(passwordHash) });
      const response = await fetch('http://application:4020/api/admin/quotes/' + q + '/status', {
        method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'sent' }) });
      assert.equal(response.status, 200);
      console.log(JSON.stringify({ quoteId: q }));
    } else {
      await check('dedicated migration idempotence and commercial ledger untouched', async () => {
        const before = (await pool.query('SELECT * FROM store.schema_migrations ORDER BY filename')).rows;
        await runNotificationMigration(); await runNotificationMigration();
        assert.deepEqual((await pool.query('SELECT * FROM store.schema_migrations ORDER BY filename')).rows, before);
      });
      await check('rollback preserves atomic history and intent; no transport', async () => {
        const fixture = await intent(false); assert.equal(await row(fixture.id), undefined);
        assert.equal((await pool.query('SELECT 1 FROM store.quote_status_history WHERE id=$1', [fixture.h])).rowCount, 0);
      });
      await check('unique event and order relationship constraints', async () => {
        const f = await intent();
        await assert.rejects(insertNotificationIntent(pool, { historyId: f.h, type: 'quote_available' }), { code: '23505' });
        await assert.rejects(insertNotificationIntent(pool, { historyId: f.h, type: 'order_confirmation', orderId: randomUUID() }), /notification_intent_not_created/);
      });
      for (const [mode, expected] of [['success','smtp_accepted'],['accepted_close','smtp_accepted'],['temporary','rejected_temporary'],['permanent','rejected_permanent'],['before','failed_before_send'],['uncertain','uncertain'],['timeout','uncertain']]) {
        await check(`SMTP ${mode} durable outcome`, async () => {
          await peer(mode); const f = await intent(); await journal().dispatch(f.id, () => deliver(150));
          assert.equal((await row(f.id)).state, expected);
          const count = (await peer()).received;
          await journal().dispatch(f.id, () => deliver()); await journal().recover();
          assert.equal((await peer()).received, count, 'terminal notification must never send again');
        });
      }
      await check('concurrent claims send once; UUID stale cannot finalize', async () => {
        await peer('success'); const f = await intent(), before = (await peer()).received;
        await Promise.all([journal().dispatch(f.id, () => deliver()), journal().dispatch(f.id, () => deliver())]);
        assert.equal((await peer()).received, before + 1); assert.equal((await row(f.id)).state, 'smtp_accepted');
        assert.equal((await pool.query("UPDATE store.notification_deliveries SET state='uncertain',result_code='transport_uncertain',finished_at=now() WHERE id=$1 AND attempt_id=$2 AND state='dispatching'", [f.id, randomUUID()])).rowCount, 0);
      });
      await check('accepted SMTP plus failed result write recovers uncertain without resend', async () => {
        const f = await intent(), life = new ServiceLifecycle(); let acquired = 0;
        const db = { connect: async () => { if (++acquired === 2) throw new Error('fixture database unavailable'); return pool.connect(); } };
        await new NotificationJournal(db, life, () => true).dispatch(f.id, () => deliver());
        assert.equal((await row(f.id)).state, 'dispatching');
        await pool.query("UPDATE store.notification_deliveries SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [f.id]);
        const count = (await peer()).received;
        await journal().recover(); assert.equal((await row(f.id)).state, 'uncertain');
        await journal().dispatch(f.id, () => deliver()); assert.equal((await peer()).received, count);
      });
      await check('lost claim result: no SMTP; expired claim becomes uncertain', async () => {
        const f = await intent(), c = await pool.connect();
        const db = { connect: async () => ({ release: () => c.release(), query: async (sql, values) => { await c.query(sql, values); throw new Error('lost database reply'); } }) };
        const before = (await peer()).received;
        await new NotificationJournal(db, new ServiceLifecycle(), () => true).dispatch(f.id, () => deliver());
        assert.equal((await peer()).received, before);
        assert.equal((await row(f.id)).state, 'dispatching');
      });
      await check('process restart with pending never sends; recovery is read/reclassify only', async () => {
        const f = await intent(), before = (await peer()).received;
        await journal().recover(); assert.equal((await row(f.id)).state, 'pending'); assert.equal((await peer()).received, before);
      });
      await check('HTTP review owner/admin scope; cancellation audited and terminal', async () => {
        const { default: express } = await import('/app/node_modules/express/index.js');
        const { createNotificationsRouter } = await import('/app/dist/modules/shared/notifications.routes.js');
        const f = await intent(); let identity = { sub: other, role: 'customer' };
        const app = express(); app.use(express.json()); app.use(createNotificationsRouter(pool, (req, res, next) => { req.user = identity; next(); }));
        const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
        const url = `http://127.0.0.1:${server.address().port}`;
        try {
          assert.equal((await fetch(url + '/quotes/' + f.q + '/notifications')).status, 404);
          assert.equal((await fetch(url + '/admin/notifications/' + f.id + '/cancel', { method: 'POST' })).status, 403);
          identity = { sub: owner, role: 'customer' };
          assert.equal((await fetch(url + '/quotes/' + f.q + '/notifications')).status, 200);
          identity = { sub: owner, role: 'admin' };
          const response = await fetch(url + '/quotes/' + f.q + '/notifications'); assert.equal(response.status, 200);
          const text = await response.text(); for (const secret of [env.mail.password, content.to, content.text]) assert.ok(!text.includes(secret));
          assert.equal((await fetch(url + '/admin/notifications/' + f.id + '/cancel', { method: 'POST' })).status, 200);
          assert.equal((await row(f.id)).state, 'cancelled');
          assert.equal((await pool.query("SELECT 1 FROM store.audit_log WHERE action='notification_cancelled' AND entity_id=$1", [f.id])).rowCount, 1);
          const uncertain = await intent(); await peer('uncertain'); await journal().dispatch(uncertain.id, () => deliver());
          const count = (await peer()).received;
          const review = await fetch(url + '/admin/notifications/' + uncertain.id + '/review', { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'acknowledge_no_resend' }) });
          assert.equal(review.status, 200); assert.deepEqual(await review.json(), { state: 'uncertain', resend: false });
          assert.equal((await row(uncertain.id)).state, 'uncertain'); assert.equal((await peer()).received, count);
        } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
      });
      await check('real commercial route: intention before SMTP, rollback on journal failure', async () => {
        const { default: express } = await import('/app/node_modules/express/index.js');
        const { createAdminQuotesRouter } = await import('/app/dist/modules/admin/quotes.routes.js');
        const app = express(); let failIntent = false;
        app.use(express.json());
        app.use(createAdminQuotesRouter({ pool, notificationJournal: journal(),
          authMiddleware: (req, res, next) => { req.user = { sub: owner, role: 'admin' }; next(); },
          insertNotificationIntent: (c, input) => { if (failIntent) throw new Error('fixture journal failure'); return insertNotificationIntent(c, input); }
        }));
        app.use((err, req, res, next) => res.status(500).json({ error: 'fixture_failure' }));
        const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
        const url = `http://127.0.0.1:${server.address().port}`;
        try {
          await peer('success'); const q = await quote();
          const response = await fetch(url + '/quotes/' + q + '/status', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'sent' }) });
          assert.equal(response.status, 200);
          const deadline = Date.now() + 3000;
          let state;
          do { state = (await scalar('SELECT d.state FROM store.notification_deliveries d JOIN store.quote_status_history h ON h.id=d.status_history_id WHERE h.quote_id=$1', [q]))?.state;
            if(state !== 'smtp_accepted') await sleep(10);
          } while(state !== 'smtp_accepted' && Date.now() < deadline);
          assert.equal(state, 'smtp_accepted');
          const rejected = await quote(), count = (await peer()).received; failIntent = true;
          const failure = await fetch(url + '/quotes/' + rejected + '/status', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'sent' }) });
          assert.equal(failure.status, 500);
          assert.equal((await scalar('SELECT status FROM store.quotes WHERE id=$1',[rejected])).status,'in_review');
          assert.equal((await pool.query('SELECT 1 FROM store.quote_status_history WHERE quote_id=$1',[rejected])).rowCount,0);
          assert.equal((await peer()).received,count);
        } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
      });
      await check('customer/admin acceptance: all notification kinds, atomic second-intent failure', async () => {
        const { default: express } = await import('/app/node_modules/express/index.js');
        const { createQuotesRouter } = await import('/app/dist/modules/quotes/quotes.routes.js');
        const { createAdminQuotesRouter } = await import('/app/dist/modules/admin/quotes.routes.js');
        await pool.query("UPDATE store.users SET role='customer' WHERE id=$1",[owner]);
        for (const scenario of ['customer','admin','second_intent_failure']) {
          const q = await quote(); await pool.query("UPDATE store.quotes SET status='sent' WHERE id=$1",[q]);
          const app=express(); app.use(express.json());
          const admin=scenario==='admin', before=(await peer('success')).received;
          const dependencies={ pool, notificationJournal:journal(),
            authMiddleware:(req,res,next)=>{req.user={sub:admin?other:owner,role:admin?'admin':'customer'};next();},
            insertNotificationIntent:async(c,input)=>{
              if(scenario==='second_intent_failure' && input.type==='order_confirmation') throw new Error('fixture second-intent failure');
              return insertNotificationIntent(c,input);
            }
          };
          app.use(admin?createAdminQuotesRouter(dependencies):createQuotesRouter(dependencies));
          app.use((err,req,res,next)=>res.status(500).json({error:'fixture_failure'}));
          const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
          try {
            const response=await fetch(`http://127.0.0.1:${server.address().port}/`+(admin?`quotes/${q}/status`:`${q}/accept`),{
              method:admin?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(admin?{status:'accepted'}:{})});
            if(scenario==='second_intent_failure') {
              assert.equal(response.status,500);
              assert.equal((await scalar('SELECT status FROM store.quotes WHERE id=$1',[q])).status,'sent');
              assert.equal((await pool.query('SELECT 1 FROM store.orders WHERE quote_id=$1',[q])).rowCount,0);
              assert.equal((await pool.query('SELECT 1 FROM store.quote_status_history WHERE quote_id=$1',[q])).rowCount,0);
              assert.equal((await peer()).received,before);
            } else {
              assert.equal(response.status,200);
              const expected=admin?1:2, deadline=Date.now()+3000;
              let deliveries=[];
              do { deliveries=(await pool.query('SELECT d.state,d.notification_type FROM store.notification_deliveries d JOIN store.quote_status_history h ON h.id=d.status_history_id WHERE h.quote_id=$1',[q])).rows;
                if(deliveries.filter(d=>d.state==='smtp_accepted').length!==expected) await sleep(10);
              } while(deliveries.filter(d=>d.state==='smtp_accepted').length!==expected && Date.now()<deadline);
              assert.equal(deliveries.length,expected); assert.ok(deliveries.every(d=>d.state==='smtp_accepted'));
              assert.deepEqual(deliveries.map(d=>d.notification_type).sort(),admin?['order_confirmation']:['order_confirmation','quote_accepted_commercial']);
              assert.equal((await peer()).received,before+expected);
            }
          } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
        }
      });
      await check('Linux runtime: ten simulated router transaction failure cases', async () => {
        const { default: express } = await import('/app/node_modules/express/index.js');
        const { createQuotesRouter } = await import('/app/dist/modules/quotes/quotes.routes.js');
        const { createAdminQuotesRouter } = await import('/app/dist/modules/admin/quotes.routes.js');
        const { verifyQuoteTransactionErrors } = await import('./quote-rollback.fixture.mjs');
        const checked=await verifyQuoteTransactionErrors({express,createQuotesRouter,createAdminQuotesRouter});
        assert.equal(checked.length,10);
      });
      await check('real PostgreSQL termination mid-transaction: both routers survive and accept new requests', async () => {
        const { default: express } = await import('/app/node_modules/express/index.js');
        const { createQuotesRouter } = await import('/app/dist/modules/quotes/quotes.routes.js');
        const { createAdminQuotesRouter } = await import('/app/dist/modules/admin/quotes.routes.js');
        for(const admin of [false,true]) {
          const q=await quote();await pool.query("UPDATE store.quotes SET status='sent' WHERE id=$1",[q]);
          let inject=true, original, received;
          const released=[];
          const wrapped={query:pool.query.bind(pool),connect:async()=>{
            const c=await pool.connect();
            return {query:async(text,values)=>{
              const result=await c.query(text,values);
              if(inject && text.startsWith('UPDATE store.quotes')) {
                inject=false;
                // Mutation is real and uncommitted. Interrupt an active query from a DIFFERENT connection.
                const interrupted=c.query('SELECT pg_sleep(10)').then(()=>null,error=>error);
                const killed=await pool.query('SELECT pg_terminate_backend($1) AS killed',[c.processID]);
                assert.equal(killed.rows[0].killed,true);
                original=await interrupted;assert.equal(original?.code,'57P01');throw original;
              }
              return result;
            },release:destroy=>{released.push(!!destroy);c.release(destroy);}};
          }};
          const app=express();app.use(express.json());app.get('/alive',(_req,res)=>res.json({alive:true}));
          const dependencies={pool:wrapped,notificationJournal:journal(),authMiddleware:(req,res,next)=>{req.user={sub:admin?other:owner,role:admin?'admin':'customer'};next();}};
          app.use(admin?createAdminQuotesRouter(dependencies):createQuotesRouter(dependencies));
          app.use((error,_req,res,_next)=>{received=error;res.status(500).json({error:'database_operation_failed'});});
          const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
          const url=`http://127.0.0.1:${server.address().port}`,before=(await peer('success')).received;
          const request=()=>fetch(url+(admin?`/quotes/${q}/status`:`/${q}/accept`),{method:admin?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(admin?{status:'accepted'}:{})});
          try {
            const failed=await request();assert.equal(failed.status,500);assert.equal(received,original);
            assert.deepEqual(released,[true]);assert.equal((await fetch(url+'/alive')).status,200);
            assert.equal((await scalar('SELECT status FROM store.quotes WHERE id=$1',[q])).status,'sent');
            for(const table of ['quote_status_history','orders']) assert.equal((await pool.query(`SELECT 1 FROM store.${table} WHERE quote_id=$1`,[q])).rowCount,0);
            assert.equal((await pool.query('SELECT 1 FROM store.notification_deliveries d JOIN store.quote_status_history h ON h.id=d.status_history_id WHERE h.quote_id=$1',[q])).rowCount,0);
            assert.equal((await peer()).received,before,'failed transaction never sent email');
            // New explicit HTTP request, NOT an automatic transaction retry.
            assert.equal((await request()).status,200);assert.deepEqual(released,[true,false]);
            const expected=admin?1:2,deadline=Date.now()+3000;
            while((await peer()).received!==before+expected && Date.now()<deadline)await sleep(10);
            assert.equal((await peer()).received,before+expected);
          } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
        }
      });
      console.log(JSON.stringify({ runtime: process.version, results }));
    }
  } finally { await closePool(); }
}
