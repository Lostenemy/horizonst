import { config } from '../config';

const CONNECTOR_NAME = 'postgres_audit_connector';
const BRIDGE_NAME = 'postgres_audit_bridge';
const RULE_ID = 'postgres_audit_rule';

class HttpRequestError extends Error {
  status: number;
  body?: string;

  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = 'HttpRequestError';
    this.status = status;
    this.body = body;
  }
}

type HttpMethod = 'GET' | 'POST' | 'PUT';

type JsonValue = unknown;

const buildBaseUrl = (): string => {
  const protocol = config.emqx.ssl ? 'https' : 'http';
  return `${protocol}://${config.emqx.host}:${config.emqx.port}/api/v5`;
};

let authToken: string | null = null;
let tokenExpiresAt: number | null = null;

interface LoginResponse {
  token: string;
  expire_at?: string;
}

const parseExpireAt = (expireAt?: string): number | null => {
  if (!expireAt) {
    return null;
  }
  const parsed = Date.parse(expireAt);
  return Number.isFinite(parsed) ? parsed : null;
};

const authenticate = async (): Promise<void> => {
  const url = `${buildBaseUrl()}/login`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: config.emqx.username,
      password: config.emqx.password
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new HttpRequestError(`Failed to authenticate with EMQX management API: ${response.status}`, response.status, body);
  }

  const payload = (await response.json()) as LoginResponse;
  authToken = payload.token;
  tokenExpiresAt = parseExpireAt(payload.expire_at);
};

const ensureAuthToken = async (): Promise<void> => {
  if (!authToken) {
    await authenticate();
    return;
  }

  if (tokenExpiresAt !== null && Date.now() >= tokenExpiresAt - 5000) {
    await authenticate();
  }
};

const request = async <T = JsonValue>(method: HttpMethod, path: string, body?: JsonValue, allowRetry = true): Promise<T> => {
  await ensureAuthToken();

  const url = `${buildBaseUrl()}${path}`;
  const headers: Record<string, string> = {};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    headers,
    body: payload
  });

  const rawText = await response.text();

  if (response.status === 401) {
    if (!allowRetry) {
      throw new HttpRequestError(`Request to ${path} failed with status ${response.status}`, response.status, rawText);
    }
    authToken = null;
    tokenExpiresAt = null;
    return request(method, path, body, false);
  }

  let parsed: JsonValue | undefined;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      if (!response.ok) {
        throw new HttpRequestError(`Request to ${path} failed with status ${response.status}`, response.status, rawText);
      }
      throw error;
    }
  }

  if (!response.ok) {
    throw new HttpRequestError(`Request to ${path} failed with status ${response.status}`, response.status, rawText);
  }

  return parsed as T;
};

const connectorPath = `/connectors/${CONNECTOR_NAME}`;

const getConnector = async (): Promise<JsonValue | null> => {
  try {
    return await request('GET', connectorPath);
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

const ensureConnector = async (): Promise<void> => {
  const connectorPayload = {
    name: CONNECTOR_NAME,
    type: 'postgresql',
    enable: true,
    description: 'PostgreSQL connector for MQTT message auditing',
    config: {
      server: `${config.database.host}:${config.database.port}`,
      database: config.database.database,
      username: config.database.user,
      password: config.database.password,
      pool_size: 16,
      auto_reconnect: true,
      ssl: false
    }
  };

  const existing = await getConnector();
  if (existing) {
    await request('PUT', connectorPath, connectorPayload);
    return;
  }

  await request('POST', '/connectors', connectorPayload);
};

const bridgePath = `/bridges/${BRIDGE_NAME}`;

const getBridge = async (): Promise<JsonValue | null> => {
  try {
    return await request('GET', bridgePath);
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

const ensureBridge = async (): Promise<void> => {
  const bridgePayload = {
    name: BRIDGE_NAME,
    type: 'postgresql',
    enable: true,
    description: 'Bridge that persists MQTT payloads in PostgreSQL for auditing',
    connector: CONNECTOR_NAME,
    config: {
      sql: 'INSERT INTO mqtt_messages (topic, payload, payload_raw, payload_encoding, client_id, qos, retain, received_at) VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))',
      parameters: [
        { field: 'topic' },
        { field: 'payload_str' },
        { field: 'payload' },
        { value: 'utf8' },
        { field: 'clientid' },
        { field: 'qos' },
        { field: 'retain' },
        { field: 'timestamp' }
      ],
      prepare_statement: false
    }
  };

  const existing = await getBridge();
  if (existing) {
    await request('PUT', bridgePath, bridgePayload);
    return;
  }

  await request('POST', '/bridges', bridgePayload);
};

const getRule = async (): Promise<JsonValue | null> => {
  try {
    return await request('GET', `/rules/${RULE_ID}`);
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

const ensureRule = async (): Promise<void> => {
  const rulePayload = {
    id: RULE_ID,
    for: 'mqtt',
    enable: true,
    description: 'Route MQTT traffic to PostgreSQL audit bridge',
    sql: 'SELECT clientid, topic, payload, payload_str, qos, retain, timestamp FROM "#"',
    actions: [
      {
        name: BRIDGE_NAME,
        type: 'bridge'
      }
    ]
  };

  const existing = await getRule();
  if (existing) {
    await request('PUT', `/rules/${RULE_ID}`, rulePayload);
    return;
  }

  await request('POST', '/rules', rulePayload);
};

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const ensureEmqxMessageAudit = async (): Promise<void> => {
  for (let attempt = 1; attempt <= config.emqx.maxRetries; attempt += 1) {
    try {
      await ensureConnector();
      await ensureBridge();
      await ensureRule();
      console.log('EMQX message audit integration is ready');
      return;
    } catch (error) {
      console.error(`Failed to configure EMQX message auditing (attempt ${attempt}/${config.emqx.maxRetries})`, error);
      if (attempt === config.emqx.maxRetries) {
        throw error;
      }
      await delay(config.emqx.retryIntervalMs);
    }
  }
};
