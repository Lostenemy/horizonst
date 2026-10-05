import { normalizeInventoryMac } from '../utils/mac';
import { sanitizeMqttObservation, validateStoredMqttObservation, PublicMqttObservation } from './gatewayMqttObservation';

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
  return canonicalPublicValue(mac, sanitizeMqttObservation(mac, data));
}

export function storedPublicMqttObservation(mac: string, data: unknown): PublicMqttObservation | null {
  return canonicalPublicValue(mac, validateStoredMqttObservation(mac, data));
}
