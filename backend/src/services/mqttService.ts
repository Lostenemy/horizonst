import mqtt, { type IPublishPacket, IClientOptions, MqttClient } from 'mqtt';
import { config } from '../config';
import { decodeMk1 } from './decoders/mk1Decoder';
import { decodeMk2 } from './decoders/mk2Decoder';
import { decodeMk3 } from './decoders/mk3Decoder';
import { handleDeviceRecord } from './deviceProcessor';
import { pool } from '../db/pool';
import { ProcessedDeviceRecord } from '../types';
import { handleRfidScanMessage } from './rfidAccess';

let client: MqttClient | null = null;
let mqttConnected = false;
let mqttLastError: string | null = null;
let reconnectDelay = config.mqtt.reconnectPeriod;

const OFFICIAL_TOPICS = ['devices/MK1', 'devices/MK2', 'devices/MK3', 'devices/MK4', 'devices/RF1'];

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

export const initMqtt = async (): Promise<void> => {
  if (client) {
    return;
  }

  return new Promise((resolve, reject) => {
    const clientId = `${config.mqtt.clientPrefix}${Math.random().toString(16).slice(2)}`;
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
    const settleResolve = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const settleReject = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    client = mqtt.connect(url, options);

    client.on('connect', () => {
      mqttConnected = true;
      mqttLastError = null;
      reconnectDelay = config.mqtt.reconnectPeriod;
      if (client) {
        client.options.reconnectPeriod = reconnectDelay;
      }
      console.log('Connected to MQTT broker');
      client?.subscribe(OFFICIAL_TOPICS, (error?: Error) => {
        if (error) {
          mqttLastError = error.message;
          console.error('Failed to subscribe to topics', error);
          if (config.mqtt.required) {
            settleReject(error);
          }
        } else {
          console.log('Subscribed to MQTT topics');
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
      setTimeout(() => {
        if (!mqttConnected) {
          settleReject(new Error('Timed out while waiting for required MQTT connection.'));
        }
      }, Math.max(config.mqtt.connectTimeout, 5000));
    }

    const shouldPersistLocally = config.mqtt.persistenceMode === 'app';

    client.on('message', async (topic: string, messageBuffer: Buffer, packet: IPublishPacket) => {
      const payloadText = messageBuffer.toString();
      const payloadHex = messageBuffer.toString('hex');
      const payloadBase64 = messageBuffer.toString('base64');
      const isRfidTopic = config.rfidAccess.enabled && topic === 'devices/RF1';
      const payloadEncoding = topic === 'devices/MK2' ? 'hex' : 'utf8';
      const storedPayload = topic === 'devices/MK2' ? payloadHex : payloadText;
      let records: ProcessedDeviceRecord[] = [];
      if (!isRfidTopic) {
        try {
          if (topic === 'devices/MK1') {
            records = decodeMk1(payloadText);
          } else if (topic === 'devices/MK2') {
            records = decodeMk2(messageBuffer);
          } else if (topic === 'devices/MK3') {
            records = decodeMk3(payloadText);
          } else if (topic === 'devices/MK4') {
            records = decodeMk2(messageBuffer);
          }
        } catch (error) {
          console.error('Failed to decode payload', error);
        }
      }

      const gatewayMac = records[0]?.gatewayMac || null;
      try {
        if (shouldPersistLocally) {
          await pool.query(
            `INSERT INTO mqtt_messages (topic, payload, payload_raw, payload_encoding, client_id, qos, retain, gateway_mac, received_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [
              topic,
              storedPayload,
              payloadBase64,
              payloadEncoding,
              null,
              packet?.qos ?? 0,
              packet?.retain ?? false,
              gatewayMac
            ]
          );
        }
      } catch (error) {
        console.error('Failed to persist MQTT message', error);
      }

      if (isRfidTopic) {
        try {
          await handleRfidScanMessage(client as MqttClient, messageBuffer);
        } catch (error) {
          console.error('Unhandled error processing RFID lectura', error);
        }
        return;
      }

      for (const record of records) {
        await handleDeviceRecord(record);
      }
    });
  });
};
