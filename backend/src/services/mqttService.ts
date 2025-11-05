import mqtt, { IClientOptions, MqttClient } from 'mqtt';
import { config } from '../config';
import { decodeMk1 } from './decoders/mk1Decoder';
import { decodeMk2 } from './decoders/mk2Decoder';
import { decodeMk3 } from './decoders/mk3Decoder';
import { handleDeviceRecord } from './deviceProcessor';
import { pool } from '../db/pool';
import { ProcessedDeviceRecord } from '../types';

let client: MqttClient | null = null;

const TOPICS = ['devices/MK1', 'devices/MK2', 'devices/MK3'];

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
    client = mqtt.connect(url, options);

    client.on('connect', () => {
      console.log('Connected to MQTT broker');
      client?.subscribe(TOPICS, (error?: Error) => {
        if (error) {
          console.error('Failed to subscribe to topics', error);
          reject(error);
        } else {
          console.log('Subscribed to MQTT topics');
          resolve();
        }
      });
    });

    client.on('error', (error: Error) => {
      console.error('MQTT error', error);
    });

    client.on('message', async (topic: string, messageBuffer: Buffer) => {
      const payloadText = messageBuffer.toString();
      const storedPayload = topic === 'devices/MK2' ? messageBuffer.toString('hex') : payloadText;
      let records: ProcessedDeviceRecord[] = [];
      try {
        if (topic === 'devices/MK1') {
          records = decodeMk1(payloadText);
        } else if (topic === 'devices/MK2') {
          records = decodeMk2(messageBuffer);
        } else if (topic === 'devices/MK3') {
          records = decodeMk3(payloadText);
        }
      } catch (error) {
        console.error('Failed to decode payload', error);
      }

      const gatewayMac = records[0]?.gatewayMac || null;
      try {
        await pool.query(
          `INSERT INTO mqtt_messages (topic, payload, gateway_mac, received_at)
           VALUES ($1, $2, $3, NOW())`,
          [topic, storedPayload, gatewayMac]
        );
      } catch (error) {
        console.error('Failed to persist MQTT message', error);
      }

      for (const record of records) {
        await handleDeviceRecord(record);
      }
    });
  });
};
