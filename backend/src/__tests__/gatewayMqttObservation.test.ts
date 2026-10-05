import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGatewayMqttConfiguration, buildHorizonstMqttPreset } from '../services/gatewayMqttConfiguration';
import { inspectPublicMqttObservation, storedPublicMqttObservation } from '../services/gatewayMqttObservationIngress';

const identity = 'a1b2c3d4e5f6'; // Fictional, never taken from a gateway.
const secret = 'fictional-observation-credential%only';
const response = () => ({ ...buildHorizonstMqttPreset(identity,'production'), passwd:secret,
  lwt_payload: JSON.stringify({msg_id:3999,device_info:{mac:identity},data:{}},null,2) });

test('2030 explicitly rejects fictional identity/secret collision without exposing the identity or credential', () => {
  const data = {...response(),passwd:identity};
  const result = inspectPublicMqttObservation(identity,data);
  assert.deepEqual(result,{ok:false,errorCode:'mqtt_observation_identity_secret_collision'});
  assert.equal(JSON.stringify(result).includes(identity),false);
  // 1030 remains a separate contract: observation privacy does not relax or
  // silently change a valid write. No command is actually published here.
  assert.throws(()=>buildGatewayMqttConfiguration(identity,data),/Invalid MQTT configuration/);
  assert.equal(buildGatewayMqttConfiguration(identity,{...data,lwt_payload:JSON.stringify(JSON.parse(data.lwt_payload))}).wirePayload.msg_id,1030);
});

test('secret duplicated in another public field remains blocked, including URL and base64 forms', () => {
  for (const representation of [secret,encodeURIComponent(secret),Buffer.from(secret).toString('base64')]) {
    const result = inspectPublicMqttObservation(identity,{...response(),client_id:`public-prefix-${representation}`});
    assert.deepEqual(result,{ok:false,errorCode:'mqtt_observation_secret_in_public_field'});
    assert.equal(JSON.stringify(result).includes(representation),false);
  }
});

test('normal response accepts whitespace in same-MAC JSON 3999 and exposes only canonical public fields', () => {
  const result = inspectPublicMqttObservation(identity,response());
  assert.equal(result.ok,true);
  if (!result.ok) throw new Error('expected public observation');
  assert.equal(Object.keys(result.value).length,15);
  assert.equal('passwd' in result.value,false);
  assert.equal(result.value.lwt_payload,JSON.stringify({msg_id:3999,device_info:{mac:identity},data:{}}));
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.deepEqual(storedPublicMqttObservation(identity,result.value),result.value);
});

test('stored observations are structurally validated, not tested against an invented secret', () => {
  const {passwd:_discard,...publicData}=response();
  assert.ok(storedPublicMqttObservation(identity,{...publicData,client_id:'validation-placeholder-not-a-credential'}));
  for (const invalid of [{...publicData,passwd:secret},{...publicData,port:'8883'},
    {...publicData,unknown:'extra'},{...publicData,lwt_payload:JSON.stringify({msg_id:3999,device_info:{mac:'f6e5d4c3b2a1'},data:{}})}]) {
    assert.equal(storedPublicMqttObservation(identity,invalid),null);
  }
});

test('canonical LWT cannot introduce a credential hidden by the raw identity casing', () => {
  const upper=identity.toUpperCase();
  const result=inspectPublicMqttObservation(identity,{...response(),passwd:'a1b2',client_id:upper,username:upper,
    sub_topic:`gw/${upper}/subscribe`,pub_topic:`gw/${upper}/publish`,lwt_topic:`gw/${upper}/publish`,
    lwt_payload:JSON.stringify({msg_id:3999,device_info:{mac:upper},data:{}})});
  assert.deepEqual(result,{ok:false,errorCode:'mqtt_observation_secret_in_public_field'});
});
