import mqtt, { type IPublishPacket, type ISubscriptionGrant, IClientOptions, MqttClient } from 'mqtt';
import { config } from '../config';
import { decodeMk2 } from './decoders/mk2Decoder';
import { handleDeviceRecord } from './deviceProcessor';
import { pool } from '../db/pool';
import { ProcessedDeviceRecord } from '../types';
import { handleHardwareGatewayAck } from './gatewayAck';
import { handleGatewayIdentityReport } from './gatewayIdentity';
import { handleGatewayConfigurationReport } from './gatewayObservedReads';

let client: MqttClient | null = null;
let mqttConnected = false;
let mqttLastError: string | null = null;
let reconnectDelay = config.mqtt.reconnectPeriod;

export const OFFICIAL_TOPICS = ['devices/MK4', 'gw/+/publish'];

type SubscriptionAssessment = { ok: true } | { ok: false; error: Error; rejectedTopics: string[] };

export const assessOfficialTopicSubscriptions = (
  error: Error | null | undefined,
  granted: readonly ISubscriptionGrant[] | undefined
): SubscriptionAssessment => {
  if (error) return { ok: false, error, rejectedTopics: [] };
  const grantByTopic = new Map((granted ?? []).map((grant) => [grant.topic, grant.qos]));
  const rejectedTopics = OFFICIAL_TOPICS.filter((topic) => grantByTopic.get(topic) === 128 || !grantByTopic.has(topic));
  if (rejectedTopics.length > 0) {
    return {
      ok: false,
      error: new Error(`MQTT official topic subscription rejected: ${rejectedTopics.join(', ')}`),
      rejectedTopics
    };
  }
  return { ok: true };
};

const parseGatewayMacFromTopic = (topic: string): string | null => {
  const match = topic.match(/^gw\/([^/]+)\/publish$/i);
  if (!match) return null;
  return String(match[1]).replace(/[:-]/g, '').toLowerCase();
};

const isBadCredentialsError = (error: Error): boolean => {
  const message = `${error.name} ${error.message}`.toLowerCase();
  return message.includes('bad username or password') || message.includes('not authorized');
};

export const getMqttStatus = () => ({
  connected: mqttConnected,
  required: config.mqtt.required,
  lastError: mqttLastError,
  reconnectDelay
});

export const publishMqttJson = async (topic: string, payload: Record<string, unknown>): Promise<void> => {
  if (!client || !mqttConnected) throw new Error('MQTT client is not connected');
  await new Promise<void>((resolve, reject) => {
    client!.publish(topic, JSON.stringify(payload), { qos: 1 }, (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
};

export const processMqttMessage = async (
  topic: string,
  messageBuffer: Buffer,
  packet: Pick<IPublishPacket, 'qos' | 'retain'> = { qos: 0, retain: false }
): Promise<void> => {
  const payloadText = messageBuffer.toString();
  const payloadBase64 = messageBuffer.toString('base64');
  let records: ProcessedDeviceRecord[] = [];
  try {
    if (topic === 'devices/MK4') records = decodeMk2(messageBuffer);
  } catch (error) {
    console.error('Failed to decode payload', error);
  }

  const gatewayMac = records[0]?.gatewayMac || parseGatewayMacFromTopic(topic) || null;
  await handleGatewayIdentityReport(topic, payloadText);
  await handleGatewayConfigurationReport(topic, payloadText);
  await handleHardwareGatewayAck(topic, payloadText);
  try {
    // MKGW3 dispone de diarios específicos para ACK y lecturas; su tráfico frecuente
    // (incluido 3070) no se duplica de forma cruda en mqtt_messages.
    if (config.mqtt.persistenceMode === 'app' && topic === 'devices/MK4') {
      await pool.query(
        `INSERT INTO mqtt_messages (topic, payload, payload_raw, payload_encoding, client_id, qos, retain, gateway_mac, received_at)
         VALUES ($1, $2, $3, 'utf8', $4, $5, $6, $7, NOW())`,
        [topic, payloadText, payloadBase64, null, packet?.qos ?? 0, packet?.retain ?? false, gatewayMac]
      );
    }
  } catch (error) {
    console.error('Failed to persist MQTT message', error);
  }

  for (const record of records) await handleDeviceRecord(record);
};

export const initMqtt = async (): Promise<void> => {
  if (client) {
    return;
  }

  return new Promise((resolve, reject) => {
    const clientId = config.mqtt.clientId;
    const url = `mqtt://${config.mqtt.host}:${config.mqtt.port}`;
    const options: IClientOptions = {
      username: config.mqtt.username,
      password: config.mqtt.password,
      keepalive: config.mqtt.keepalive,
      reconnectPeriod: config.mqtt.reconnectPeriod,
      protocolId: config.mqtt.protocolId,
      protocolVersion: config.mqtt.protocolVersion,
      clean: config.mqtt.clean,
      connectTimeout: config.mqtt.connectTimeout,
      clientId
    };

    if (!config.mqtt.username || !config.mqtt.password) {
      const warning = 'MQTT credentials are empty. Configure MQTT_USER/MQTT_PASS (or MQTT_USERNAME/MQTT_PASSWORD).';
      mqttLastError = warning;
      console.warn(warning);
      if (config.mqtt.required) {
        reject(new Error(warning));
        return;
      }
    }

    let settled = false;
    let startupTimer: NodeJS.Timeout | undefined;
    const settleResolve = () => {
      if (!settled) {
        settled = true;
        if (startupTimer) clearTimeout(startupTimer);
        resolve();
      }
    };
    const settleReject = (error: Error) => {
      if (!settled) {
        settled = true;
        if (startupTimer) clearTimeout(startupTimer);
        reject(error);
      }
    };

    client = mqtt.connect(url, options);

    client.on('connect', () => {
      mqttConnected = false;
      reconnectDelay = config.mqtt.reconnectPeriod;
      if (client) {
        client.options.reconnectPeriod = reconnectDelay;
      }
      console.log('Connected to MQTT broker');
      client?.subscribe(OFFICIAL_TOPICS, (error, granted) => {
        const assessment = assessOfficialTopicSubscriptions(error, granted);
        if (!assessment.ok) {
          mqttConnected = false;
          mqttLastError = assessment.error.message;
          console.error('Failed to subscribe to all official MQTT topics', assessment.error);
          if (config.mqtt.required) {
            settleReject(assessment.error);
          }
        } else {
          mqttConnected = true;
          mqttLastError = null;
          console.log('Subscribed to all official MQTT topics');
          settleResolve();
        }
      });
    });

    client.on('close', () => {
      mqttConnected = false;
    });

    client.on('reconnect', () => {
      mqttConnected = false;
      reconnectDelay = Math.min(config.mqtt.reconnectMaxPeriod, reconnectDelay * 2);
      if (client) {
        client.options.reconnectPeriod = reconnectDelay;
      }
      console.warn(`MQTT reconnect scheduled in ${reconnectDelay}ms`);
    });

    client.on('error', (error: Error) => {
      mqttLastError = error.message;
      console.error('MQTT error', error);
      if (config.mqtt.required && isBadCredentialsError(error)) {
        settleReject(error);
      }
    });

    if (!config.mqtt.required) {
      console.warn('MQTT is running in optional mode. HTTP server startup is not blocked by broker connectivity.');
      settleResolve();
    } else {
      startupTimer = setTimeout(() => {
        if (!mqttConnected) {
          settleReject(new Error('Timed out while waiting for required MQTT connection.'));
        }
      }, Math.max(config.mqtt.connectTimeout, 5000));
    }

    client.on('message', async (topic: string, messageBuffer: Buffer, packet: IPublishPacket) => {
      try {
        await processMqttMessage(topic, messageBuffer, packet);
      } catch (error) {
        console.error('Failed to process MQTT message', error);
      }
    });
  });
};

export const resetMqttStateForTests = (): void => {
  client?.removeAllListeners();
  client = null;
  mqttConnected = false;
  mqttLastError = null;
  reconnectDelay = config.mqtt.reconnectPeriod;
};
