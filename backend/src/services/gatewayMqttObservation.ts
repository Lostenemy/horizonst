import { buildGatewayMqttConfiguration, MQTT_CONFIGURATION_KEYS, MQTT_CONFIGURATION_LIMITS } from './gatewayMqttConfiguration';
import { normalizeGatewayMac } from '../utils/mac';

export type PublicMqttObservation = Omit<import('./gatewayMqttConfiguration').GatewayMqttConfigurationData, 'passwd'>;
export type MqttObservationErrorCode = 'mqtt_observation_invalid_response'
  | 'mqtt_observation_identity_secret_collision' | 'mqtt_observation_secret_in_public_field';
export type MqttObservationInspection = { ok: true; value: PublicMqttObservation }
  | { ok: false; errorCode: MqttObservationErrorCode };

// The observation contract permits JSON whitespace. Compact only this JSON
// value before structural checks; the 1030 write validator remains unchanged.
function observationData(input: Record<string, unknown>): Record<string, unknown> {
  const data = Object.fromEntries(MQTT_CONFIGURATION_KEYS.map(key => [key,input[key]]));
  if (typeof data.lwt_payload !== 'string' || Buffer.byteLength(data.lwt_payload,'utf8') > MQTT_CONFIGURATION_LIMITS.lwtPayloadBytes) {
    throw new Error('invalid_observation');
  }
  data.lwt_payload=JSON.stringify(JSON.parse(data.lwt_payload));
  return data;
}

// Called at ingress, before all journals, ACK handlers and raw capture paths.
// Unknown fields are discarded. Invalid/secret-bearing text never leaves here.
export function inspectMqttObservation(macInput: string, input: unknown): MqttObservationInspection {
  const invalid = (): MqttObservationInspection => ({ ok: false, errorCode: 'mqtt_observation_invalid_response' });
  const mac = normalizeGatewayMac(macInput);
  if (!mac || !input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const raw = input as Record<string, unknown>;
  const secret = raw.passwd;
  if (typeof secret !== 'string' || !secret || secret.length > 256) return invalid();
  let data: Record<string,unknown>;
  try { data=observationData(raw); buildGatewayMqttConfiguration(mac,data); } catch { return invalid(); }
  const publicData = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'passwd'));
  // Identity being public elsewhere does NOT make it safe when it is a secret.
  if (secret === mac || secret === data.client_id || secret === data.username) {
    return { ok: false, errorCode: 'mqtt_observation_identity_secret_collision' };
  }
  // Never expose the password even if duplicated into another allowed text field.
  const forbidden = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')];
  if (Object.values(publicData).some(value => typeof value === 'string' && forbidden.some(part => part && value.includes(part)))) {
    return { ok: false, errorCode: 'mqtt_observation_secret_in_public_field' };
  }
  return { ok: true, value: publicData as PublicMqttObservation };
}

export function sanitizeMqttObservation(macInput: string, input: unknown): PublicMqttObservation | null {
  const result = inspectMqttObservation(macInput, input);
  return result.ok ? result.value : null;
}

export function validateStoredMqttObservation(mac: string, input: unknown): PublicMqttObservation | null {
  if (!input || typeof input !== 'object' || Array.isArray(input) || 'passwd' in input) return null;
  const keys = MQTT_CONFIGURATION_KEYS.filter(key => key !== 'passwd');
  if (Object.keys(input).sort().join(',') !== [...keys].sort().join(',')) return null;
  // Structural revalidation only: the stored public object contains no secret.
  // Do not pretend a placeholder can prove safety against the current credential.
  let data: Record<string,unknown>;
  try {
    data=observationData({ ...input, passwd: 'validation-placeholder-not-a-credential' });
    buildGatewayMqttConfiguration(mac,data);
  }
  catch { return null; }
  const {passwd:_placeholder,...publicData}=data;
  return publicData as PublicMqttObservation;
}
