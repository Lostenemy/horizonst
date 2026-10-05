import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { Client, Pool } from 'pg';

const enabled=process.env.GATEWAY_MQTT_RECOVERY_ALLOW_DATABASE_TESTS === 'true';

test('PostgreSQL 15: opening 2030 after rejection retains identity but excludes passwd and preserves history/locks', {
  skip:enabled ? false : 'requires an explicit disposable PostgreSQL 15 database'
},async()=>{
  // Never target the application's default database or a remote/shared server.
  assert.equal(process.env.DB_HOST,'127.0.0.1');
  assert.equal(process.env.DB_NAME,'horizonst_mqtt_recovery_test');
  const config={host:process.env.DB_HOST,port:Number(process.env.DB_PORT || 5432),user:process.env.DB_USER,
    password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionTimeoutMillis:2000,
    statement_timeout:2000,query_timeout:2500};
  const schema=`mqtt_recovery_${randomUUID().replace(/-/g,'')}`;
  const admin=new Client(config);await admin.connect();
  let acquired=false;
  let testPool:Pool|undefined;
  const {pool}=await import('../db/pool');
  const originalConnect=pool.connect;
  const previous=process.env.GATEWAY_MQTT_OBSERVATION_ENABLED;
  const service=await import('../services/gatewayObservedReads');
  const {GatewayIdentityBusyError}=await import('../services/gatewayIdentity');
  const {buildHorizonstMqttPreset}=await import('../services/gatewayMqttConfiguration');
  const company='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const mac='a1b2c3d4e5f6';
  const secret='fictional-isolated-recovery-credential';
  try {
    assert.match((await admin.query("SELECT current_setting('server_version') AS version")).rows[0].version,/^15\./);
    await admin.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await admin.query(`CREATE SCHEMA ${schema}`);acquired=true;
    await admin.query(`SET search_path TO ${schema},public`);
    await admin.query(`CREATE TABLE companies(id UUID PRIMARY KEY);
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE gateways(id INTEGER PRIMARY KEY,company_id UUID NOT NULL REFERENCES companies(id),
        mac_address CHAR(12) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE);
      INSERT INTO companies VALUES ('${company}');INSERT INTO users VALUES (1);
      INSERT INTO gateways(id,company_id,mac_address) VALUES (1,'${company}','${mac}');`);
    for(const migration of ['009_gateway_identity_reads.sql','010_gateway_observed_configuration_reads.sql',
      '011_gateway_ble_connected_devices.sql','014_gateway_mqtt_observations.sql']) {
      await admin.query('BEGIN');
      try {await admin.query(readFileSync(path.join(process.cwd(),'migrations',migration),'utf8'));await admin.query('COMMIT');}
      catch(error){await admin.query('ROLLBACK');throw error;}
    }
    testPool=new Pool({...config,options:`-c search_path=${schema},public`,max:5});
    (pool as any).connect=()=>testPool!.connect();
    process.env.GATEWAY_MQTT_OBSERVATION_ENABLED='true';
    await admin.query(`INSERT INTO hardware_gateway_reads(gateway_id,company_id,msg_id,read_type,request_payload,
      status,actor_user_id,timeout_ms,response_observed_at,error_message)
      SELECT 1,$1,2030,'mqtt_configuration','{"msg_id":2030}', 'invalid_response',1,2000,NOW(),
        'observed response failed strict schema validation' FROM generate_series(1,3)`,[company]);
    const history=(await admin.query('SELECT * FROM hardware_gateway_reads ORDER BY id')).rows;
    let publications=0;
    const params={gatewayId:1,companyId:company,gatewayMac:mac,readType:'mqtt_configuration' as const,
      actorUserId:1,timeoutMs:2000,deps:{publish:async()=>{publications++;
        await service.handleGatewayConfigurationReport(`gw/${mac}/publish`,JSON.stringify({msg_id:2030,
          device_info:{mac},data:{...buildHorizonstMqttPreset(mac,'production'),passwd:secret}}));}}};
    const result=await service.executeGatewayConfigurationRead(params);
    assert.equal(result.status,'response_observed');assert.equal(publications,1);
    assert.deepEqual((await admin.query('SELECT * FROM hardware_gateway_reads WHERE id = ANY($1::uuid[]) ORDER BY id',
      [history.map(row=>row.id)])).rows,history);
    const saved=(await admin.query('SELECT public_value FROM hardware_gateway_mqtt_observations')).rows;
    assert.equal(saved.length,1);assert.equal(Object.keys(saved[0].public_value).length,15);
    assert.doesNotMatch(JSON.stringify({result,saved}),new RegExp(secret));
    // Identity equality is explicitly permitted, without retaining passwd.
    const collision=await service.executeGatewayConfigurationRead({...params,confirmRecovery:true,deps:{publish:async()=>{
      publications++;await service.handleGatewayConfigurationReport(`gw/${mac}/publish`,JSON.stringify({msg_id:2030,
        device_info:{mac},data:{...buildHorizonstMqttPreset(mac,'production'),passwd:mac}}));}}});
    assert.equal(collision.status,'response_observed');
    assert.equal(collision.errorCode,undefined);
    assert.equal((collision.data as any).client_id,mac);assert.equal('passwd' in collision.data!,false);
    const rejected=(await admin.query('SELECT status,response_payload,error_message FROM hardware_gateway_reads WHERE id=$1',
      [collision.readId])).rows[0];
    assert.equal(rejected.status,'response_observed');assert.equal(rejected.error_message,null);
    assert.equal('passwd' in rejected.response_payload.data,false);
    assert.equal(rejected.response_payload.data.client_id,mac);
    const holder=await testPool.connect();
    try {
      await holder.query('SELECT pg_advisory_lock(7246,1)');
      await assert.rejects(service.executeGatewayConfigurationRead({...params,confirmRecovery:true}),GatewayIdentityBusyError);
    }finally{await holder.query('SELECT pg_advisory_unlock(7246,1)');holder.release();}
    for(const status of ['timed_out','publish_error','pending','published']) {
      // Use a different gateway per state. No cleanup of previous uncertain history.
      const id=['timed_out','publish_error','pending','published'].indexOf(status)+2;
      const otherMac=`a1b2c3d4e5f${id}`;
      await admin.query('INSERT INTO gateways(id,company_id,mac_address) VALUES($1,$2,$3)',[id,company,otherMac]);
      const prior=(await admin.query(`INSERT INTO hardware_gateway_reads(gateway_id,company_id,msg_id,read_type,
        request_payload,status,actor_user_id,timeout_ms,created_at)
        VALUES($1,$2,2030,'mqtt_configuration','{"msg_id":2030}',$3,1,100,NOW()-INTERVAL '1 day') RETURNING *`,
        [id,company,status])).rows[0];
      await assert.rejects(service.executeGatewayConfigurationRead({...params,gatewayId:id,gatewayMac:otherMac,
        confirmRecovery:true}),GatewayIdentityBusyError);
      assert.deepEqual((await admin.query('SELECT * FROM hardware_gateway_reads WHERE id=$1',[prior.id])).rows[0],prior);
    }
    assert.equal(publications,2);
    const journal=(await admin.query('SELECT response_payload,error_message FROM hardware_gateway_reads')).rows;
    assert.equal(JSON.stringify(journal).includes(secret),false);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM hardware_gateway_reads')).rows[0].n,9);
  }finally{
    service.resetGatewayConfigurationWaitersForTests();(pool as any).connect=originalConnect;
    if(previous===undefined)delete process.env.GATEWAY_MQTT_OBSERVATION_ENABLED;
    else process.env.GATEWAY_MQTT_OBSERVATION_ENABLED=previous;
    await testPool?.end();
    try {if(acquired)await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}
  }
});
