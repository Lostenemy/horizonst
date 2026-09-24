import { isIP } from 'node:net';
import { normalizeGatewayMac } from '../utils/mac';
import type { GatewayCommandPayload } from './gatewayCommands';

export const MQTT_CONFIGURATION_LIMITS = {
  hostBytes: 253,
  identifierBytes: 256,
  passwordBytes: 256,
  topicBytes: 1024,
  lwtPayloadBytes: 4096,
  keepaliveMax: 65535
} as const;

export const MQTT_CONFIGURATION_KEYS = [
  'security_type', 'host', 'port', 'client_id', 'username', 'passwd', 'sub_topic',
  'pub_topic', 'qos', 'clean_session', 'keepalive', 'lwt_en', 'lwt_qos',
  'lwt_retain', 'lwt_topic', 'lwt_payload'
] as const;

export type GatewayMqttConfigurationData = {
  security_type: number;
  host: string;
  port: number;
  client_id: string;
  username: string;
  passwd: string;
  sub_topic: string;
  pub_topic: string;
  qos: number;
  clean_session: number;
  keepalive: number;
  lwt_en: number;
  lwt_qos: number;
  lwt_retain: number;
  lwt_topic: string;
  lwt_payload: string;
};

export type GatewayMqttConfigurationPayloads = {
  wirePayload: GatewayCommandPayload;
  persistedPayload: GatewayCommandPayload;
};

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');
const hasControl = (value: string): boolean => /[\u0000-\u001f\u007f]/.test(value);
const isExactObject = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
};

const isDnsHost = (value: string): boolean => value.length <= 253
  && value.split('.').every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));

const isValidHost = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0
  && byteLength(value) <= MQTT_CONFIGURATION_LIMITS.hostBytes
  && !hasControl(value)
  && !/\s/.test(value)
  && !value.includes('://')
  && !value.includes('/')
  && (isIP(value) !== 0 || isDnsHost(value));

const isBoundedText = (value: unknown, maxBytes: number): value is string => typeof value === 'string'
  && value.length > 0
  && value.trim().length > 0
  && byteLength(value) <= maxBytes
  && !hasControl(value);

const isTopic = (value: unknown, publishing: boolean): value is string => isBoundedText(
  value,
  MQTT_CONFIGURATION_LIMITS.topicBytes
) && (!publishing || (!value.includes('#') && !value.includes('+')));

const integerIn = (value: unknown, allowed: readonly number[]): value is number => Number.isInteger(value)
  && allowed.includes(value as number);

function isValidLwtPayload(value: unknown, gatewayMac: string): value is string {
  if (!isBoundedText(value, MQTT_CONFIGURATION_LIMITS.lwtPayloadBytes)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  if (!isExactObject(parsed, ['msg_id', 'device_info', 'data'])) return false;
  const record = parsed as Record<string, unknown>;
  if (record.msg_id !== 3999 || !isExactObject(record.device_info, ['mac'])) return false;
  const deviceInfo = record.device_info as Record<string, unknown>;
  if (typeof deviceInfo.mac !== 'string' || normalizeGatewayMac(deviceInfo.mac) !== gatewayMac) return false;
  return isExactObject(record.data, []);
}

export function buildHorizonstMqttPreset(gatewayMacInput: string): GatewayMqttConfigurationData {
  const mac = normalizeGatewayMac(gatewayMacInput);
  if (!mac) throw new Error('Invalid gateway MAC');
  return {
    security_type: 1,
    host: 'mqtt.horizonst.com.es',
    port: 8883,
    client_id: mac,
    username: mac,
    passwd: '',
    sub_topic: `gw/${mac}/subscribe`,
    pub_topic: `gw/${mac}/publish`,
    qos: 0,
    clean_session: 1,
    keepalive: 60,
    lwt_en: 1,
    lwt_qos: 1,
    lwt_retain: 0,
    lwt_topic: `gw/${mac}/publish`,
    lwt_payload: JSON.stringify({ msg_id: 3999, device_info: { mac }, data: {} })
  };
}

export function buildGatewayMqttConfiguration(
  gatewayMacInput: string,
  input: unknown
): GatewayMqttConfigurationPayloads {
  const mac = normalizeGatewayMac(gatewayMacInput);
  if (!mac || !isExactObject(input, MQTT_CONFIGURATION_KEYS)) {
    throw new Error('Invalid MQTT configuration');
  }
  const data = input as Record<string, unknown>;
  const valid = integerIn(data.security_type, [0, 1])
    && isValidHost(data.host)
    && Number.isInteger(data.port) && (data.port as number) >= 1 && (data.port as number) <= 65535
    && isBoundedText(data.client_id, MQTT_CONFIGURATION_LIMITS.identifierBytes)
    && isBoundedText(data.username, MQTT_CONFIGURATION_LIMITS.identifierBytes)
    && typeof data.passwd === 'string' && data.passwd.length > 0
    && byteLength(data.passwd) <= MQTT_CONFIGURATION_LIMITS.passwordBytes
    && isTopic(data.sub_topic, false)
    && isTopic(data.pub_topic, true)
    && integerIn(data.qos, [0, 1])
    && integerIn(data.clean_session, [0, 1])
    && Number.isInteger(data.keepalive) && (data.keepalive as number) >= 0
    && (data.keepalive as number) <= MQTT_CONFIGURATION_LIMITS.keepaliveMax
    && integerIn(data.lwt_en, [0, 1])
    && integerIn(data.lwt_qos, [0, 1])
    && integerIn(data.lwt_retain, [0, 1])
    && isTopic(data.lwt_topic, true)
    && isValidLwtPayload(data.lwt_payload, mac);
  if (!valid) throw new Error('Invalid MQTT configuration');

  const validated = Object.fromEntries(MQTT_CONFIGURATION_KEYS.map((key) => [key, data[key]])) as
    GatewayMqttConfigurationData;
  const wirePayload: GatewayCommandPayload = {
    msg_id: 1030,
    device_info: { mac },
    data: validated
  };
  return {
    wirePayload,
    persistedPayload: {
      ...wirePayload,
      data: { ...validated, passwd: '[REDACTED]' }
    }
  };
}
