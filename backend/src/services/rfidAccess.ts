import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { MqttClient } from 'mqtt';
import { config } from '../config';
import { pool } from '../db/pool';

interface RfidCardRow {
  id: number;
  card_uid: string;
  dni: string;
  first_name: string;
  last_name: string;
  company_name: string;
  company_cif: string;
  center_code: string;
  active: boolean;
}

interface RfidMessage {
  cardUid: string;
  antennaId?: string | null;
  readerId?: string | null;
  timestamp?: string;
  rawPayload: string;
}

interface GpioPublication {
  topic: string;
  payload: string;
}

interface RequestError extends Error {
  status?: number;
  responseBody?: string;
  responseData?: unknown;
}

const cardKeys = ['cardId', 'card_id', 'card', 'uid', 'tag', 'tagId', 'tag_id', 'rfid', 'id', 'tarjeta'];
const antennaKeys = ['antenna', 'antennaId', 'antenna_id', 'antena', 'antennaName'];
const readerKeys = ['reader', 'readerId', 'reader_id', 'device', 'gateway', 'mac', 'macAddress', 'lector'];
const timestampKeys = ['timestamp', 'ts', 'time', 'event_time'];

const sendAccessRequest = (
  requestBody: string
): Promise<{ statusCode: number; data: unknown; raw: string }> => {
  const target = new URL(config.rfidAccess.api.url);
  const isHttps = target.protocol === 'https:';
  const options: https.RequestOptions = {
    method: 'POST',
    hostname: target.hostname,
    port: target.port ? Number(target.port) : isHttps ? 443 : 80,
    path: `${target.pathname}${target.search}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(requestBody)
    },
    timeout: config.rfidAccess.api.timeoutMs
  };

  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(options, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk as Buffer));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown = null;
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch (_error) {
            parsed = raw;
          }
        }
        const statusCode = response.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve({ statusCode, data: parsed, raw });
          return;
        }
        const error = new Error(`Access API responded with status ${statusCode}`) as RequestError;
        error.status = statusCode;
        error.responseBody = raw;
        error.responseData = parsed;
        reject(error);
      });
    });
    request.on('error', (error) => {
      reject(error);
    });
    request.setTimeout(config.rfidAccess.api.timeoutMs, () => {
      request.destroy(new Error('Request timed out'));
    });
    request.write(requestBody);
    request.end();
  });
};

const normalizeCardUid = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().toUpperCase();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
};

const parseTimestamp = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return undefined;
};

const parseRfidPayload = (payload: Buffer): RfidMessage | null => {
  const raw = payload.toString('utf8').trim();
  if (!raw) {
    return null;
  }

  let cardUid: string | null = null;
  let antennaId: string | null = null;
  let readerId: string | null = null;
  let timestamp: string | undefined;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const key of cardKeys) {
        if (key in parsed) {
          cardUid = normalizeCardUid((parsed as Record<string, unknown>)[key]);
          if (cardUid) break;
        }
      }
      for (const key of antennaKeys) {
        if (key in parsed) {
          antennaId = normalizeString((parsed as Record<string, unknown>)[key]);
          if (antennaId) break;
        }
      }
      for (const key of readerKeys) {
        if (key in parsed) {
          readerId = normalizeString((parsed as Record<string, unknown>)[key]);
          if (readerId) break;
        }
      }
      for (const key of timestampKeys) {
        if (key in parsed) {
          timestamp = parseTimestamp((parsed as Record<string, unknown>)[key]);
          if (timestamp) break;
        }
      }
      if (!cardUid && typeof parsed === 'object' && parsed !== null) {
        const maybeNested = (parsed as Record<string, unknown>).card;
        if (maybeNested && typeof maybeNested === 'object') {
          for (const key of cardKeys) {
            if (key in (maybeNested as Record<string, unknown>)) {
              cardUid = normalizeCardUid((maybeNested as Record<string, unknown>)[key]);
              if (cardUid) break;
            }
          }
        }
      }
    }
  } catch (_error) {
    // not JSON, fall back to raw
  }

  if (!cardUid) {
    cardUid = normalizeCardUid(raw);
  }

  if (!cardUid) {
    return null;
  }

  return {
    cardUid,
    antennaId,
    readerId,
    timestamp,
    rawPayload: raw
  };
};

const determineDirection = (antennaId?: string | null): string | null => {
  if (!antennaId) {
    return null;
  }
  const normalized = antennaId.toLowerCase();
  if (normalized.includes('sal') || normalized.includes('exit')) {
    return 'EXIT';
  }
  if (normalized.includes('ent') || normalized.includes('in')) {
    return 'ENTRY';
  }
  return null;
};

const publishGpio = async (
  client: MqttClient,
  readerId: string,
  allowed: boolean
): Promise<GpioPublication | null> => {
  const { gpio } = config.rfidAccess;
  const pin = allowed ? gpio.greenPin : gpio.redPin;
  if (!pin || !client) {
    return null;
  }

  const resolvedReader = readerId || config.rfidAccess.defaultReaderId || 'rfid-reader';
  const pinStr = String(pin);
  let topic = gpio.topicTemplate.replace('{reader}', resolvedReader).replace('{pin}', pinStr);
  if (!gpio.topicTemplate.includes('{pin}')) {
    topic = `${topic.replace(/\/+$/, '')}/${pinStr}`;
  }

  const payload = JSON.stringify({
    pin,
    state: 1,
    durationMs: gpio.pulseDurationMs,
    signal: allowed ? 'GREEN' : 'RED',
    source: 'horizonst'
  });

  await new Promise<void>((resolve, reject) => {
    client.publish(
      topic,
      payload,
      { qos: gpio.qos, retain: false },
      (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }
    );
  });

  return { topic, payload };
};

const interpretAccessDecision = (responseData: unknown): { allowed: boolean; status?: string } => {
  if (!responseData || typeof responseData !== 'object') {
    return { allowed: false };
  }
  const root = responseData as Record<string, unknown>;
  const container =
    (root.response && typeof root.response === 'object' ? (root.response as Record<string, unknown>) : null) || root;
  const accesoValue = container.acceso ?? container.access ?? container.allowed;
  const statusValue = container.status ?? container.result;
  if (typeof accesoValue === 'number') {
    return { allowed: accesoValue === 1, status: statusValue ? String(statusValue) : undefined };
  }
  if (typeof accesoValue === 'string') {
    const normalized = accesoValue.trim();
    return { allowed: normalized === '1' || normalized.toLowerCase() === 'true', status: statusValue ? String(statusValue) : undefined };
  }
  if (typeof accesoValue === 'boolean') {
    return { allowed: accesoValue, status: statusValue ? String(statusValue) : undefined };
  }
  return { allowed: false, status: statusValue ? String(statusValue) : undefined };
};

export const handleRfidScanMessage = async (
  client: MqttClient,
  payload: Buffer
): Promise<void> => {
  if (!config.rfidAccess.enabled) {
    return;
  }

  const message = parseRfidPayload(payload);
  if (!message) {
    console.warn('RFID payload recibido sin tarjeta válida');
    return;
  }

  const eventTimestamp = message.timestamp ? new Date(message.timestamp) : new Date();
  const normalizedCard = message.cardUid;
  let card: RfidCardRow | null = null;
  let accessAllowed: boolean | null = null;
  let apiStatus: string | undefined;
  let apiError: string | undefined;
  let apiResponse: unknown;
  let requestPayload: Record<string, unknown> | null = null;
  let gpioPublication: GpioPublication | null = null;

  try {
    const result = await pool.query<RfidCardRow>(
      `SELECT id, card_uid, dni, first_name, last_name, company_name, company_cif, center_code, active
       FROM rfid_cards
       WHERE card_uid = $1
       LIMIT 1`,
      [normalizedCard]
    );
    card = result.rows[0] ?? null;
  } catch (error) {
    console.error('No se pudo consultar la tarjeta RFID', error);
  }

  if (!card || !card.active) {
    accessAllowed = false;
    apiError = 'CARD_NOT_REGISTERED';
    console.warn({ cardUid: normalizedCard }, 'Intento de acceso con tarjeta no registrada');
  } else if (!config.rfidAccess.api.token) {
    accessAllowed = false;
    apiError = 'MISSING_API_TOKEN';
    console.error('Token del webservice RFID no configurado');
  } else {
    requestPayload = {
      data: {
        centro_cod: card.center_code,
        empresa_cif: card.company_cif,
        trabajador_dni: card.dni
      }
    };
    try {
      const form = new URLSearchParams();
      form.set('action', config.rfidAccess.api.action);
      form.set('action_type', config.rfidAccess.api.actionType);
      form.set('brand', config.rfidAccess.api.brand);
      form.set('data', JSON.stringify(requestPayload));
      form.set('in', config.rfidAccess.api.inputFormat);
      form.set('instance', config.rfidAccess.api.instance);
      form.set('out', config.rfidAccess.api.outputFormat);
      form.set('user', config.rfidAccess.api.user);
      form.set('token', config.rfidAccess.api.token);

      const response = await sendAccessRequest(form.toString());
      apiResponse = response.data;
      const decision = interpretAccessDecision(response.data);
      accessAllowed = decision.allowed;
      apiStatus = decision.status || String(response.statusCode);
    } catch (error) {
      const requestError = error as RequestError;
      apiError = requestError.responseBody || requestError.message;
      apiStatus = requestError.status ? String(requestError.status) : requestError.message;
      if (requestError.responseData !== undefined) {
        apiResponse = requestError.responseData;
      }
      accessAllowed = false;
      console.error('Error al consultar el webservice de accesos', requestError.message);
    }
  }

  const direction = determineDirection(message.antennaId);

  try {
    gpioPublication = await publishGpio(
      client,
      message.readerId || config.rfidAccess.defaultReaderId,
      Boolean(accessAllowed)
    );
  } catch (error) {
    console.error('No se pudo publicar la orden GPIO', error);
  }

  try {
    await pool.query(
      `INSERT INTO rfid_access_logs
         (card_uid, dni, center_code, company_cif, antenna_id, direction, reader_id, event_timestamp,
          access_allowed, api_status, api_error, request_payload, api_response, raw_message,
          gpio_command_topic, gpio_command_payload, created_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12::jsonb, $13::jsonb, $14,
          $15, $16, NOW())`,
      [
        normalizedCard,
        card?.dni ?? null,
        card?.center_code ?? null,
        card?.company_cif ?? null,
        message.antennaId ?? null,
        direction,
        message.readerId ?? config.rfidAccess.defaultReaderId,
        eventTimestamp,
        accessAllowed,
        apiStatus ?? null,
        apiError ?? null,
        requestPayload ? JSON.stringify(requestPayload) : null,
        apiResponse ? JSON.stringify(apiResponse) : null,
        message.rawPayload,
        gpioPublication?.topic ?? null,
        gpioPublication?.payload ?? null
      ]
    );
  } catch (error) {
    console.error('No se pudo registrar el evento RFID', error);
  }
};
