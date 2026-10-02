import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import test from 'node:test';
const url=process.env.DEVICE_TYPES_TEST_DATABASE_URL;
test('PostgreSQL 15 isolated: migration, policies, immutable references, grandfathering and concurrent removal',
 {skip: !url || process.env.DEVICE_TYPES_ALLOW_DATABASE_TESTS!=='true' ? 'explicit disposable local PostgreSQL 15 required' : false},async()=>{
  const parsed=new URL(url!);assert(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname));assert.match(parsed.pathname,/^\/[a-z0-9_]+_isolated_test$/);
  const admin=new Pool({connectionString:url,connectionTimeoutMillis:3000,query_timeout:5000});
  const schema=`device_types_${randomUUID().replace(/-/g,'')}`;
  let database:Pool|undefined,created=false;
  const company='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',inactive='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  try{
    assert.match((await admin.query("SELECT current_setting('server_version') AS version")).rows[0].version,/^15\./);
    await admin.query(`CREATE SCHEMA ${schema}`);created=true;
    database=new Pool({connectionString:url,options:`-c search_path=${schema} -c statement_timeout=4000`,connectionTimeoutMillis:3000,query_timeout:5000});
    await database.query(`CREATE TABLE companies(id uuid PRIMARY KEY,active boolean NOT NULL);
      CREATE TABLE devices(id serial PRIMARY KEY,ble_mac text UNIQUE,company_id uuid REFERENCES companies(id) ON DELETE RESTRICT,
        device_type varchar(32) NOT NULL DEFAULT 'unknown',active boolean NOT NULL,status text NOT NULL,
        CONSTRAINT devices_device_type_check CHECK(device_type IN('tag','b5','sensor','beacon','unknown')));
      CREATE TABLE history(id serial PRIMARY KEY,device_id integer REFERENCES devices(id) ON DELETE RESTRICT);
      CREATE TABLE app_schema_migrations(name text PRIMARY KEY,checksum text NOT NULL);
      INSERT INTO companies VALUES('${company}',true),('${inactive}',false);
      INSERT INTO devices(ble_mac,company_id,device_type,active,status) VALUES
        ('ABCDEF000001','${company}','b5',true,'active'),('ABCDEF000002','${inactive}','tag',false,'inactive'),('ABCDEF000003',NULL,'unknown',false,'inactive');
      INSERT INTO history(device_id) VALUES(1),(2),(3);`);
    const before=(await database.query('SELECT * FROM devices ORDER BY id')).rows;
    const migration=readFileSync('migrations/013_device_type_catalog.sql','utf8');
    // Mismo contrato transaccional/checksum del runner; repetir no reaplica DDL.
    const checksum=createHash('sha256').update(migration).digest('hex');
    const migrate=async()=>{const client=await database!.connect();try{await client.query('BEGIN');const applied=await client.query('SELECT checksum FROM app_schema_migrations WHERE name=$1',['013_device_type_catalog.sql']);if(applied.rows.length)assert.equal(applied.rows[0].checksum,checksum);else{await client.query(migration);await client.query('INSERT INTO app_schema_migrations VALUES($1,$2)',['013_device_type_catalog.sql',checksum]);}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}};
    await migrate();await migrate();assert.deepEqual((await database.query('SELECT * FROM devices ORDER BY id')).rows,before);
    assert.equal((await database.query('SELECT count(*)::int AS n FROM history')).rows[0].n,3);
    assert.equal((await database.query('SELECT count(*)::int AS n FROM company_device_types')).rows[0].n,2);
    const rejects=(sql:string,values:any[]=[])=>assert.rejects(database!.query(sql,values),(e:any)=>['23514','23503','23505'].includes(e.code));
    await rejects('DELETE FROM company_device_types WHERE company_id=$1',[inactive]);
    await rejects("UPDATE device_types SET code='renamed' WHERE code='b5'");await rejects("DELETE FROM device_types WHERE code='b5'");
    await rejects("INSERT INTO device_types(code,name) VALUES('b5','duplicate')");
    await database.query("UPDATE device_types SET active=false WHERE code='b5'");
    await database.query("UPDATE devices SET status='active',device_type='b5' WHERE id=1");
    assert.equal((await database.query('SELECT hardware_device_policy(device_type,company_id) AS policy FROM devices WHERE id=1')).rows[0].policy.horneoCompatible,true);
    await rejects("INSERT INTO devices(device_type,company_id,active,status) VALUES('b5',$1,true,'active')",[company]);
    await rejects("INSERT INTO devices(device_type,company_id,active,status) VALUES('sensor',$1,true,'active')",[company]);
    await rejects("INSERT INTO devices(device_type,active,status) VALUES('missing',true,'active')");
    await database.query("INSERT INTO device_types(code,name) VALUES('test_sensor','Test sensor')");
    await database.query('INSERT INTO company_device_types VALUES($1,$2)',[company,'test_sensor']);
    assert.equal((await database.query("SELECT hardware_device_policy('test_sensor',$1) AS policy",[company])).rows[0].policy.horneoCompatible,false);
    const first=await database.connect(),second=await database.connect();
    try{
      await first.query('BEGIN');await first.query("INSERT INTO devices(device_type,company_id,active,status) VALUES('test_sensor',$1,false,'inactive')",[company]);
      const removal=second.query('DELETE FROM company_device_types WHERE company_id=$1 AND type_code=$2',[company,'test_sensor']);
      // Adjuntar manejador antes de COMMIT: sin rechazo huérfano.
      const rejected=assert.rejects(removal,(e:any)=>e.code==='23514');await first.query('COMMIT');await rejected;
      assert.equal((await database.query('SELECT count(*)::int AS n FROM company_device_types WHERE company_id=$1 AND type_code=$2',[company,'test_sensor'])).rows[0].n,1);
    }finally{await first.query('ROLLBACK');first.release();second.release();}
    await database.query('INSERT INTO companies VALUES($1,true)',['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
    await rejects("UPDATE devices SET company_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc',device_type='tag' WHERE id=2");
    assert.deepEqual((await database.query('SELECT * FROM devices WHERE id<=3 ORDER BY id')).rows,before);
  }finally{await database?.end();if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
