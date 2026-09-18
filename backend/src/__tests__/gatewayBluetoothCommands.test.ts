import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBluetoothGatewayCommand, isBluetoothOperation } from '../services/gatewayBluetoothCommands';

const mac = '28:05:A5:5E:FB:68';

test('documented BLE controls create canonical, exact command payloads', () => {
  const cases = [
    ['scan', { scan_switch: 1 }, 1040],
    ['filter-relation', { relation: 8 }, 1041],
    ['duplicates', { rule: 3 }, 1057],
    ['phy', { phy_filter: 4 }, 1060],
    ['report-interval', { interval: 0 }, 1063],
    ['scan-mode', { scan_mode: 1 }, 1066]
  ] as const;
  for (const [operation, data, msgId] of cases) {
    assert.deepEqual(buildBluetoothGatewayCommand(mac, operation, data), {
      msg_id: msgId,
      device_info: { mac: '2805A55EFB68' },
      data
    });
  }
});

test('BLE controls reject unsupported operations, extra fields, wrong types and ranges', () => {
  assert.equal(isBluetoothOperation('raw-command'), false);
  assert.throws(() => buildBluetoothGatewayCommand(mac, 'scan', { scan_switch: 1, hidden: 1 }));
  assert.throws(() => buildBluetoothGatewayCommand(mac, 'scan', { scan_switch: '1' }));
  assert.throws(() => buildBluetoothGatewayCommand(mac, 'phy', { phy_filter: 5 }));
  assert.throws(() => buildBluetoothGatewayCommand(mac, 'report-interval', { interval: -1 }));
  assert.throws(() => buildBluetoothGatewayCommand(mac, 'report-interval', { interval: 86401 }));
  assert.throws(() => buildBluetoothGatewayCommand('bad-mac', 'scan', { scan_switch: 1 }));
});
