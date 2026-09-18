import test from 'node:test';
import assert from 'node:assert/strict';
import { executeConnectedTagCommandSequence } from '../tag-physical-alarm.service';
import { ResolvedTargetCandidate } from '../../infrastructure/tag-control.repository';

const candidates: ResolvedTargetCandidate[] = [
  { tagId: 'tag-1', tagUid: 'aabbcc', gatewayId: 'gw-1', gatewayMac: '2805a55eec00' },
  { tagId: 'tag-1', tagUid: 'aabbcc', gatewayId: 'gw-2', gatewayMac: '007007e0c804' }
];

test('tries the next gateway when the first connect fails and then runs the alarm actions', async () => {
  const calls: string[] = [];
  const result = await executeConnectedTagCommandSequence({
    tagId: 'tag-1',
    tagUid: 'aabbcc',
    candidates,
    deps: {
      connect: async ({ gatewayMac }) => {
        calls.push(`connect:${gatewayMac}`);
        if (gatewayMac === '2805a55eec00') throw new Error('command connect failed result_code=4 result_msg=no object error');
      },
      disconnect: async ({ gatewayMac }) => { calls.push(`disconnect:${gatewayMac}`); },
      markActive: async ({ gatewayMac }) => { calls.push(`active:${gatewayMac}`); },
      markDisconnected: async () => { calls.push('disconnected'); }
    },
    runActions: async (target) => { calls.push(`actions:${target.gatewayMac}`); }
  });

  assert.equal(result.status, 'success');
  assert.equal(result.selectedGatewayMac, '007007e0c804');
  assert.deepEqual(result.connectFailures, [{ gatewayMac: '2805a55eec00', error: 'command connect failed result_code=4 result_msg=no object error' }]);
  assert.deepEqual(calls, [
    'connect:2805a55eec00',
    'connect:007007e0c804',
    'active:007007e0c804',
    'actions:007007e0c804',
    'disconnect:007007e0c804',
    'disconnected'
  ]);
});

test('returns failed_no_gateway_connected when all candidate gateways fail to connect', async () => {
  const calls: string[] = [];
  const result = await executeConnectedTagCommandSequence({
    tagId: 'tag-1',
    tagUid: 'aabbcc',
    candidates,
    deps: {
      connect: async ({ gatewayMac }) => {
        calls.push(`connect:${gatewayMac}`);
        throw new Error(`connect failed on ${gatewayMac}`);
      },
      disconnect: async ({ gatewayMac }) => { calls.push(`disconnect:${gatewayMac}`); },
      markActive: async ({ gatewayMac }) => { calls.push(`active:${gatewayMac}`); },
      markDisconnected: async () => { calls.push('disconnected'); }
    },
    runActions: async (target) => { calls.push(`actions:${target.gatewayMac}`); }
  });

  assert.equal(result.status, 'failed_no_gateway_connected');
  assert.equal(result.selectedGatewayMac, undefined);
  assert.deepEqual(result.connectFailures.map((failure) => failure.gatewayMac), ['2805a55eec00', '007007e0c804']);
  assert.deepEqual(calls, ['connect:2805a55eec00', 'connect:007007e0c804']);
});

test('runs connect, buzzer/vibration action callback, disconnect and state cleanup on the selected gateway', async () => {
  const calls: string[] = [];
  const result = await executeConnectedTagCommandSequence({
    tagId: 'tag-1',
    tagUid: 'aabbcc',
    candidates: [candidates[1]],
    deps: {
      connect: async ({ gatewayMac }) => { calls.push(`connect:${gatewayMac}`); },
      disconnect: async ({ gatewayMac }) => { calls.push(`disconnect:${gatewayMac}`); },
      markActive: async ({ gatewayMac }) => { calls.push(`active:${gatewayMac}`); },
      markDisconnected: async () => { calls.push('disconnected'); }
    },
    runActions: async (target) => {
      calls.push(`buzzer:${target.gatewayMac}`);
      calls.push(`vibration:${target.gatewayMac}`);
    }
  });

  assert.equal(result.status, 'success');
  assert.equal(result.selectedGatewayMac, '007007e0c804');
  assert.deepEqual(calls, [
    'connect:007007e0c804',
    'active:007007e0c804',
    'buzzer:007007e0c804',
    'vibration:007007e0c804',
    'disconnect:007007e0c804',
    'disconnected'
  ]);
});

test('historical 1150 ambiguity attempts actions on the same gateway without claiming physical success', async () => {
  const calls: string[] = [];
  let disconnectConfirmed: boolean | undefined;
  const result = await executeConnectedTagCommandSequence({
    tagId: 'tag-1', tagUid: 'fd9d4f8ae226',
    candidates: [{ ...candidates[0], gatewayMac: '142b2fe271b4' }, candidates[1]],
    deps: {
      connect: async ({ gatewayMac }) => { calls.push(`connect:${gatewayMac}`); return 'ambiguous'; },
      disconnect: async ({ gatewayMac }) => { calls.push(`disconnect:${gatewayMac}`); return 'confirmed'; },
      markActive: async ({ gatewayMac }) => { calls.push(`lease:${gatewayMac}`); },
      markDisconnected: async ({ confirmed }) => { disconnectConfirmed = confirmed; calls.push('closed'); }
    },
    runActions: async ({ gatewayMac }) => { calls.push(`alarm:${gatewayMac}`); return 'confirmed'; }
  });
  assert.equal(result.status, 'attempted_unverified');
  assert.equal(result.selectedGatewayMac, '142b2fe271b4');
  assert.equal(disconnectConfirmed, true);
  assert.deepEqual(calls, [
    'connect:142b2fe271b4', 'lease:142b2fe271b4', 'alarm:142b2fe271b4',
    'disconnect:142b2fe271b4', 'closed'
  ]);
});

test('an ambiguous action or disconnect never reports a confirmed physical alarm', async () => {
  const result = await executeConnectedTagCommandSequence({
    tagId: 'tag-1', tagUid: 'fd9d4f8ae226', candidates: [candidates[0]],
    deps: {
      connect: async () => 'confirmed',
      disconnect: async () => 'ambiguous',
      markActive: async () => undefined,
      markDisconnected: async ({ confirmed }) => assert.equal(confirmed, false)
    },
    runActions: async () => 'ambiguous'
  });
  assert.equal(result.status, 'attempted_unverified');
});
