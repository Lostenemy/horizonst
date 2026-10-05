import { normalizeInventoryMac } from '../utils/mac';
import { inspectMqttObservation, validateStoredMqttObservation, PublicMqttObservation, MqttObservationInspection } from './gatewayMqttObservation';

// Canonicalize the observed LWT contract. Do not retain arbitrary JSON strings,
// escape sequences or extra MAC characters from untrusted firmware text.
function canonicalPublicValue(mac: string, value: PublicMqttObservation | null): PublicMqttObservation | null {
  if (!value) return null;
  try {
    const lwt = JSON.parse(value.lwt_payload);
    if (normalizeInventoryMac(lwt.device_info.mac, 'gateway') !== mac) return null;
    return { ...value, lwt_payload: JSON.stringify({ msg_id: 3999, device_info: { mac }, data: {} }) };
  } catch { return null; }
}

export function publicMqttObservation(mac: string, data: unknown): PublicMqttObservation | null {
  const result = inspectPublicMqttObservation(mac, data);
  return result.ok ? result.value : null;
}

export function inspectPublicMqttObservation(mac: string, data: unknown): MqttObservationInspection {
  const result = inspectMqttObservation(mac, data);
  if (!result.ok) return result;
  const value = canonicalPublicValue(mac, result.value);
  if (!value) return { ok: false, errorCode: 'mqtt_observation_invalid_response' };
  // Canonicalization can introduce identity text absent from the raw casing or
  // escapes. Apply the same privacy guard to the final public representation.
  return inspectMqttObservation(mac, {...value,passwd:(data as Record<string,unknown>).passwd});
}

export function storedPublicMqttObservation(mac: string, data: unknown): PublicMqttObservation | null {
  return canonicalPublicValue(mac, validateStoredMqttObservation(mac, data));
}
