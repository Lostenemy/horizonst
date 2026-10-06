import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// Static fixture contract, not a substitute for execution on PostgreSQL 15.
function mutationSql(source:string):string[]{
  const file=ts.createSourceFile('fixture.ts',source,ts.ScriptTarget.Latest,true);
  const statements:string[]=[];
  const visit=(node:ts.Node)=>{
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)
      &&node.expression.name.text==='query'&&node.arguments[0]){
      const arg=node.arguments[0];
      if(ts.isStringLiteralLike(arg))statements.push(arg.text);
      else if(ts.isTemplateExpression(arg))statements.push(arg.getText(file));
    }
    ts.forEachChild(node,visit);
  };
  visit(file);
  return statements.filter(sql=>/\b(?:UPDATE|DELETE FROM) (cold_room_sessions|tag_gateway_presence_state|controlled_b5_presence_operations)\b/i.test(sql));
}

function assertScoped(sql:string):void{
  if(/\b(?:UPDATE|DELETE FROM) cold_room_sessions\b/i.test(sql))
    assert.match(sql,/\bWHERE\s+id=\$\d+/i);
  if(/\b(?:UPDATE|DELETE FROM) controlled_b5_presence_operations\b/i.test(sql)){
    assert.match(sql,/\bWHERE\s+session_id=\$\d+/i);
    assert.match(sql,/\bAND\s+hardware_device_id=13\b/i);
  }
  if(/\bUPDATE tag_gateway_presence_state\b/i.test(sql)){
    assert.match(sql,/\bWHERE\s+hardware_device_id=13\b/i);
    assert.match(sql,/\bAND\s+hardware_gateway_id=41\b/i);
  }
}

test('PostgreSQL fixture mutations are scoped; broad legacy resets fail the contract',()=>{
  const source=readFileSync(join(process.cwd(),'src/modules/compliance/__tests__/controlled-ble-presence.postgres.test.ts'),'utf8');
  const mutations=mutationSql(source);assert.ok(mutations.length>=10);
  for(const sql of mutations)assertScoped(sql);
  for(const sql of ['UPDATE cold_room_sessions SET ended_at=NULL',
    'UPDATE tag_gateway_presence_state SET last_presence_at=clock_timestamp()',
    'DELETE FROM controlled_b5_presence_operations'])assert.throws(()=>assertScoped(sql));
  assert.match(source,/SELECT ended_at IS NULL AS open FROM cold_room_sessions WHERE id=\$1 AND hardware_device_id=13/);
  assert.match(source,/assert\.deepEqual\(await otherFixtures\(\),before\)/);
});
