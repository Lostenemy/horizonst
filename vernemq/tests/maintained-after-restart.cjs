// Isolated fixtures only. Never connect this test to a live broker.
const assert=require('node:assert/strict'),mqtt=require('/usr/src/app/node_modules/mqtt');
const c=mqtt.connect('mqtt://horizonst-migration-broker:1883',{clientId:'fixture-persistent',username:'fixture',password:'isolated-fixture-only',clean:false,reconnectPeriod:0,connectTimeout:5000});
const timer=setTimeout(()=>{console.error('restart test timeout');c.end(true);process.exit(1)},10000);
c.on('error',e=>{console.error(e.message);clearTimeout(timer);c.end(true);process.exitCode=1});
c.once('connect',packet=>{
 try{assert.equal(packet.sessionPresent,true);console.log('PASS persistent session survives broker restart')}catch(e){console.error(e.message);clearTimeout(timer);c.end(true);process.exitCode=1;return}
 c.on('message',(topic,p,msg)=>{if(topic==='test/migration/allowed/retained'){
 try{assert.equal(p.toString(),'synthetic-retained');assert.equal(msg.retain,true);console.log('PASS retained message survives broker restart')}catch(e){console.error(e.message);process.exitCode=1}
 clearTimeout(timer);c.end(true)
 }});
 c.subscribe('test/migration/allowed/retained',{qos:1},e=>{if(e){console.error(e.message);process.exitCode=1;clearTimeout(timer);c.end(true)}});
});
