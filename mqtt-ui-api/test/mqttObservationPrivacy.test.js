import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('actual GATT message listener drops 2030 before logs, waiters or SSE', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const listener = source.slice(source.indexOf('gattMqttClient.on("message"'), source.indexOf('\nfunction buildUrl'));
  let callback; const events = []; const logs = []; const waiters = [];
  vm.runInNewContext(listener, { gattMqttClient: { on(_event, handler) { callback = handler; } },
    gattMqttPubTopicPatterns: ['gw/+/publish'], topicMatchesPattern: () => true,
    parseJsonPayload: buffer => { try { return JSON.parse(buffer.toString()); } catch { return null; } },
    notifySseClients: (...args) => events.push(args), resolvePendingForMessage: (...args) => waiters.push(args),
    logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) } });
  for (const payload of [{ msg_id: 2030, data: { passwd: 'fake-trace-2030' } },
    { msg_id: '2030', result_code: 0, data: { passwd: 'fake-trace-2030' } }]) {
    callback('gw/142b2fe271b4/publish', Buffer.from(JSON.stringify(payload)));
  }
  callback('gw/142b2fe271b4/publish', Buffer.from('{"msg_id":2030,"passwd":"fake-trace-2030"'));
  assert.deepEqual({ events, logs, waiters }, { events: [], logs: [], waiters: [] });
});
