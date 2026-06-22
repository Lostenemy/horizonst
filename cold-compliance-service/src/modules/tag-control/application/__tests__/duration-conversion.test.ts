import test from 'node:test';
import assert from 'node:assert/strict';
import { durationMsToGatewaySeconds } from '../tag-physical-alarm.service';

test('converts physical alarm durations from milliseconds to gateway seconds', () => {
  assert.equal(durationMsToGatewaySeconds(15000), 15);
  assert.equal(durationMsToGatewaySeconds(1000), 1);
  assert.equal(durationMsToGatewaySeconds(500), 1);
  assert.equal(durationMsToGatewaySeconds(2500), 3);
});
