import { buildGatewayMqttConfiguration, MQTT_CONFIGURATION_KEYS } from './gatewayMqttConfiguration';
import { normalizeGatewayMac } from '../utils/mac';

export type PublicMqttObservation = Omit<import('./gatewayMqttConfiguration').GatewayMqttConfigurationData, 'passwd'>;

// Called at ingress, before all journals, ACK handlers and raw capture paths.
// Unknown fields are discarded. Invalid/secret-bearing text never leaves here.
export function sanitizeMqttObservation(macInput: string, input: unknown): PublicMqttObservation | null {
  const mac = normalizeGatewayMac(macInput);
  if (!mac || !input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const secret = raw.passwd;
  if (typeof secret !== 'string' || !secret || secret.length > 256) return null;
  const data = Object.fromEntries(MQTT_CONFIGURATION_KEYS.map(key => [key, raw[key]]));
  const publicData = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'passwd'));
  // Never expose the password even if duplicated into another allowed text field.
  const forbidden = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')];
  if (Object.values(publicData).some(value => typeof value === 'string' && forbidden.some(part => part && value.includes(part)))) return null;
  try {
    buildGatewayMqttConfiguration(mac, data);
    return publicData as PublicMqttObservation;
  } catch { return null; }
}

export function validateStoredMqttObservation(mac: string, input: unknown): PublicMqttObservation | null {
  if (!input || typeof input !== 'object' || Array.isArray(input) || 'passwd' in input) return null;
  const keys = MQTT_CONFIGURATION_KEYS.filter(key => key !== 'passwd');
  if (Object.keys(input).sort().join(',') !== [...keys].sort().join(',')) return null;
  return sanitizeMqttObservation(mac, { ...input, passwd: 'validation-placeholder-not-a-credential' });
}
