import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGatewayPayload } from '../payload-parser';

const topic = 'gateway/aabbccddeeff/publish';

function payloadWithTimestamp(timestamp: unknown): Buffer {
  return Buffer.from(JSON.stringify({ type_code: 7, mac: '11:22:33:44:55:66', timestamp }), 'utf8');
}

test('payload timestamp epoch is ignored in favor of receivedAt', () => {
  const receivedAt = new Date('2026-01-10T12:34:56.000Z');
  const events = parseGatewayPayload(topic, payloadWithTimestamp(1779358340117), receivedAt);
  assert.equal(events[0].timestamp, receivedAt.toISOString());
});

test('payload timestamp small relative number is ignored', () => {
  const receivedAt = new Date('2026-01-10T12:34:56.000Z');
  const events = parseGatewayPayload(topic, payloadWithTimestamp(3351), receivedAt);
  assert.equal(events[0].timestamp, receivedAt.toISOString());
});

test('payload timestamp null/undefined uses receivedAt', () => {
  const receivedAt = new Date('2026-01-10T12:34:56.000Z');
  const eventsNull = parseGatewayPayload(topic, payloadWithTimestamp(null), receivedAt);
  const eventsUndefined = parseGatewayPayload(topic, payloadWithTimestamp(undefined), receivedAt);
  assert.equal(eventsNull[0].timestamp, receivedAt.toISOString());
  assert.equal(eventsUndefined[0].timestamp, receivedAt.toISOString());
});

test('payload timestamp in the future is ignored', () => {
  const receivedAt = new Date('2026-01-10T12:34:56.000Z');
  const events = parseGatewayPayload(topic, payloadWithTimestamp('2099-01-01T00:00:00Z'), receivedAt);
  assert.equal(events[0].timestamp, receivedAt.toISOString());
});

test('receivedAt before 2025 does not produce accepted session start timestamp', () => {
  const receivedAt = new Date('1970-01-01T00:00:03.351Z');
  const events = parseGatewayPayload(topic, payloadWithTimestamp(3351), receivedAt);
  assert.ok(Date.parse(events[0].timestamp) < Date.parse('2025-01-01T00:00:00.000Z'));
});
