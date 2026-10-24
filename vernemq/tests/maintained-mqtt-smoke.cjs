// Isolated fixtures only. Never connect this test to a live broker.
const assert = require('node:assert/strict');
const mqtt = require('/usr/src/app/node_modules/mqtt');
const all=[];
function connect(id, extra={}) {
 return new Promise((resolve,reject)=>{
  const c=mqtt.connect('mqtt://horizonst-migration-broker:1883',{
   clientId:id,username:'fixture',password:'isolated-fixture-only',
   reconnectPeriod:0,connectTimeout:5000,...extra
  }); all.push(c);
  c.once('connect',packet=>resolve({c,packet}));
  c.once('error',reject);
 });
}
const sub=(c,t)=>new Promise((resolve,reject)=>c.subscribe(t,{qos:1},(e,g)=>e?reject(e):resolve(g)));
const pub=(c,t,p,opts={})=>new Promise((resolve,reject)=>c.publish(t,p,{qos:1,...opts},e=>e?reject(e):resolve()));
const end=c=>new Promise(r=>c.end(false,{},r));
function receive(c,topic,expected) {
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{c.off('message',handler);reject(new Error('message timeout '+topic))},5000);
  function handler(t,p,packet){if(t===topic){clearTimeout(timer);c.off('message',handler);try{assert.equal(p.toString(),expected);resolve(packet)}catch(e){reject(e)}}}
  c.on('message',handler);
 });
}
(async()=>{
 const deadline=setTimeout(()=>{console.error('suite deadline');process.exit(2)},45000);
 try {
  await assert.rejects(connect('wrong-password',{password:'wrong-fixture'}), /Bad username or password/i); console.log('PASS incorrect password rejected');
  const {c:a}=await connect('fixture-a'); console.log('PASS PostgreSQL bcrypt login');
  await sub(a,'test/migration/allowed/live');
  let incoming=receive(a,'test/migration/allowed/live','synthetic-xyz');
  await pub(a,'test/migration/allowed/live','synthetic-xyz');
  await incoming; console.log('PASS QoS1 publish / subscribe');
  let rejected=false;
  try {const g=await sub(a,'test/migration/forbidden/#');rejected=g.every(x=>x.qos===128)} catch(e){rejected=true}
  assert(rejected); console.log('PASS forbidden subscription denied');
  await pub(a,'test/migration/allowed/retained','synthetic-retained',{retain:true});
  const {c:b}=await connect('fixture-b');
  incoming=receive(b,'test/migration/allowed/retained','synthetic-retained');
  await sub(b,'test/migration/allowed/retained');
  assert.equal((await incoming).retain,true); console.log('PASS retained delivery');
  let {c:p}=await connect('fixture-persistent',{clean:false});
  await sub(p,'test/migration/allowed/offline');await end(p);
  await pub(a,'test/migration/allowed/offline','synthetic-offline');
  const second=await connect('fixture-persistent',{clean:false});
  assert.equal(second.packet.sessionPresent,true);
  await receive(second.c,'test/migration/allowed/offline','synthetic-offline');
  console.log('PASS persistent session / offline QoS1');
  const {c:audit}=await connect('audit-listener',{username:'audit'});
  await sub(audit,'test/migration/forbidden/#');
  let forbiddenSeen=false;audit.on('message',()=>forbiddenSeen=true);
  const {c:denied}=await connect('fixture-denied-publisher');
  denied.publish('test/migration/forbidden/item','synthetic-blocked',{qos:1},()=>{});
  await new Promise(r=>setTimeout(r,1200));
  assert.equal(forbiddenSeen,false);console.log('PASS forbidden publish not delivered');
 } finally {clearTimeout(deadline);for(const c of all)c.end(true)}
})().catch(e=>{console.error(e.message);process.exitCode=1});
