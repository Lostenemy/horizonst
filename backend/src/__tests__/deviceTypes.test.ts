import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import app from '../app';
import { pool } from '../db/pool';
import { credentialVersion, signToken } from '../utils/jwt';
import { operationalDevicePolicy, validDeviceTypeCode } from '../services/deviceTypePolicy';
import { Role } from '../types';
const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', FOREIGN='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let server: http.Server, base: string;
const originalQuery=pool.query, originalConnect=pool.connect;
before(async()=>{ server=http.createServer(app); await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve)); base=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`; });
after(async()=>{ pool.query=originalQuery; pool.connect=originalConnect; await new Promise<void>(resolve=>server.close(()=>resolve())); });
function fixture(role: Role) {
  const catalog=new Map<string,any>([['b5',{code:'b5',name:'B5',description:'',active:true}]]);
  let selected=['b5'], rejectRemoval=false; const writes: string[]=[];
  const query=async(sql:string,values:any[]=[])=>{
    if(sql.includes('FROM users'))return{rows:[{id:1,role,password_hash:'fixture-hash'}]};
    if(sql.includes('company_user_memberships'))return{rows:[{company_id:COMPANY}]};
    if(sql.includes('FROM companies'))return{rows:values[0]===FOREIGN?[]:[{id:COMPANY}]};
    if(sql.startsWith('SELECT type_code'))return{rows:selected.map(type_code=>({type_code}))};
    if(sql.startsWith('SELECT')&&sql.includes('FROM device_types'))return{rows:values.length?[catalog.get(values[0])].filter(Boolean):[...catalog.values()]};
    writes.push(sql);
    if(sql.startsWith('INSERT INTO device_types')){ if(catalog.has(values[0]))throw{code:'23505'}; const row={code:values[0],name:values[1],description:values[2],active:true};catalog.set(row.code,row);return{rows:[row]}; }
    if(sql.startsWith('UPDATE device_types')){const row={code:values[0],name:values[1],description:values[2],active:values[3]};catalog.set(row.code,row);return{rows:[row]};}
    if(sql.startsWith('DELETE FROM company_device_types')){if(rejectRemoval)throw{code:'23514'};selected=selected.filter(code=>values[1].includes(code));}
    if(sql.startsWith('INSERT INTO company_device_types'))selected.push(values[1]);
    return{rows:[]};
  };
  (pool as any).query=query;(pool as any).connect=async()=>({query,release(){}});
  const headers={Authorization:`Bearer ${signToken({userId:1,role,credentialVersion:credentialVersion('fixture-hash')})}`,'Content-Type':'application/json'};
  return{catalog,writes,reject:()=>{rejectRemoval=true;},request:(path:string,method='GET',body?:any)=>fetch(base+'/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})};
}
test('code contract and operational decision: inactive catalog does not revoke existing B5; missing policy fails closed',()=>{
  assert(validDeviceTypeCode('sensor_v2'));for(const value of ['B5','a-b','x'.repeat(33),null])assert(!validDeviceTypeCode(value));
  const device={active:true,status:'active',device_type:'b5',type_policy:{known:true,typeActive:false,companyAllowed:true,horneoCompatible:true}};
  assert(operationalDevicePolicy(device));
  assert(!operationalDevicePolicy({...device,device_type:'sensor'}));
  assert(!operationalDevicePolicy({...device,type_policy:undefined}));
  assert(!operationalDevicePolicy({...device,type_policy:{...device.type_policy,companyAllowed:false}}));
});
for(const role of ['ADMIN','hardware_superadmin','hardware_technician','hardware_readonly','USER'] as Role[])test(`catalog and company policy authorization: ${role}`,async()=>{
  const f=fixture(role);assert.equal((await f.request('/device-types')).status,200);
  const global=['ADMIN','hardware_superadmin'].includes(role);
  assert.equal((await f.request('/device-types','POST',{code:'test',name:'Test'})).status,global?201:403);
  assert.equal((await f.request('/device-types/b5','PATCH',{name:'Updated'})).status,global?200:403);
  assert.equal((await f.request('/device-types/b5','DELETE')).status,global?200:403);
  assert.equal((await f.request(`/companies/${COMPANY}/device-types`)).status,role==='USER'?403:200);
  assert.equal((await f.request(`/companies/${COMPANY}/device-types`,'PUT',{types:[]})).status,global?200:403);
  assert.equal((await f.request(`/companies/${FOREIGN}/device-types`)).status,role==='USER'?403:404);
});
test('catalog duplicate, immutable code, audited deactivation and reactivation',async()=>{
  const f=fixture('ADMIN'); assert.equal((await f.request('/device-types','POST',{code:'b5',name:'Duplicate'})).status,409);
  assert.equal((await f.request('/device-types/b5','PATCH',{code:'new'})).status,400);
  assert.equal((await f.request('/device-types/b5','DELETE')).status,200);assert.equal(f.catalog.get('b5').active,false);
  assert.equal((await f.request('/device-types/b5','PATCH',{active:true})).status,200);assert.equal(f.catalog.get('b5').active,true);
  assert(f.writes.some(sql=>sql.includes('technical_audit_log')));assert(f.writes.includes('ROLLBACK'));
});
test('policy removal with referenced inactive devices rolls back; malformed and duplicate selections rejected',async()=>{
  const f=fixture('ADMIN');f.reject();assert.equal((await f.request(`/companies/${COMPANY}/device-types`,'PUT',{types:[]})).status,409);
  assert(f.writes.includes('ROLLBACK'));assert(!f.writes.includes('COMMIT'));
  for(const types of [['b5','b5'],['B5'],'all'])assert.equal((await f.request(`/companies/${COMPANY}/device-types`,'PUT',{types})).status,400);
});
test('unavailable catalog and connection return recoverable 503 without assuming a policy',async()=>{
  const f=fixture('ADMIN');
  (pool as any).connect=async()=>{throw new Error('simulated unavailable database');};
  assert.equal((await f.request('/device-types','POST',{code:'test',name:'Test'})).status,503);
  assert.equal((await f.request(`/companies/${COMPANY}/device-types`,'PUT',{types:[]})).status,503);
  (pool as any).query=async(sql:string)=>{if(sql.includes('FROM users'))return{rows:[{id:1,role:'ADMIN',password_hash:'fixture-hash'}]};throw new Error('simulated unavailable policy');};
  assert.equal((await f.request('/device-types')).status,503);
});
