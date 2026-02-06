import cors from "cors";
import express from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import mqtt from "mqtt";
import pino from "pino";
import tls from "tls";

const logger = pino({
  level: process.env.LOG_LEVEL || "info"
});

const app = express();
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

const corsOrigin = process.env.UI_CORS_ORIGIN || "http://127.0.0.1:8090";
app.use(
  cors({
    origin: corsOrigin.split(",").map((value) => value.trim()),
    credentials: true
  })
);

const port = Number.parseInt(process.env.PORT || "4010", 10);

const jwtSecret = process.env.UI_JWT_SECRET || "";
const uiUser = process.env.UI_ADMIN_USER || "";
const uiPassword = process.env.UI_ADMIN_PASSWORD || "";

const observerBaseUrl = process.env.VMQ_OBSERVER_BASE_URL || "http://vernemq_observer:4040";
const observerStatusPath = process.env.VMQ_OBSERVER_STATUS_PATH || "/status";
const observerMetricsPath = process.env.VMQ_OBSERVER_METRICS_PATH || "/metrics";
const observerListenersPath = process.env.VMQ_OBSERVER_LISTENERS_PATH || "/listeners";
const observerClusterPath = process.env.VMQ_OBSERVER_CLUSTER_PATH || "/cluster";
const observerTimeoutMs = Number.parseInt(process.env.VMQ_OBSERVER_TIMEOUT_MS || "4000", 10);

const mqttHost = process.env.MQTT_DIAG_HOST || "mqtt.horizonst.com.es";
const mqttPort = Number.parseInt(process.env.MQTT_DIAG_PORT || "8883", 10);
const mqttDiagTimeoutMs = Number.parseInt(process.env.MQTT_DIAG_TIMEOUT_MS || "5000", 10);

const gattDefaultPass = process.env.GATT_DEFAULT_PASS || "Moko4321";
const gattTimeoutMs = Number.parseInt(process.env.GATT_TIMEOUT_MS || "10000", 10);
const gattRateLimitWindowMs = Number.parseInt(process.env.GATT_RATE_LIMIT_WINDOW_MS || "60000", 10);
const gattRateLimitMax = Number.parseInt(process.env.GATT_RATE_LIMIT_MAX || "20", 10);
const gattMqttHost = process.env.GATT_MQTT_HOST || "vernemq";
const gattMqttPort = Number.parseInt(process.env.GATT_MQTT_PORT || "1883", 10);
const gattMqttTls = process.env.GATT_MQTT_TLS === "true";
const gattMqttRejectUnauthorized = process.env.GATT_MQTT_REJECT_UNAUTHORIZED !== "false";
const gattMqttUsername = process.env.GATT_MQTT_USERNAME || process.env.MQTT_USER || "";
const gattMqttPassword = process.env.GATT_MQTT_PASSWORD || process.env.MQTT_PASS || "";
const gattMqttClientId =
  process.env.GATT_MQTT_CLIENT_ID || "mqtt-ui-api-gatt";
const gattMqttSubTopicPattern = process.env.GATT_MQTT_SUB_TOPIC_PATTERN || "/MK110/{gatewayMac}/receive";
const gattMqttPubTopicSubscribe = process.env.GATT_MQTT_PUB_TOPIC_SUBSCRIBE || "/MK110/+/send";
const gattSseTicketTtlMs = Number.parseInt(process.env.GATT_SSE_TICKET_TTL_MS || "60000", 10);

const gattExpectedConnectMsgIds = parseMsgIdList(process.env.GATT_CONNECT_EXPECTED_MSG_IDS, [2500, 3501]);
const gattExpectedInfoMsgIds = parseMsgIdList(process.env.GATT_INQUIRE_DEVICE_INFO_EXPECTED_MSG_IDS, [2502, 3502]);
const gattExpectedStatusMsgIds = parseMsgIdList(process.env.GATT_INQUIRE_STATUS_EXPECTED_MSG_IDS, [2504, 3504]);

const gattMqttClient = mqtt.connect({
  host: gattMqttHost,
  port: gattMqttPort,
  protocol: gattMqttTls ? "mqtts" : "mqtt",
  rejectUnauthorized: gattMqttRejectUnauthorized,
  username: gattMqttUsername || undefined,
  password: gattMqttPassword || undefined,
  clientId: gattMqttClientId,
  reconnectPeriod: 1500,
  keepalive: 60
});

const pendingGattReplies = new Map();
const gattSseClients = new Set();
const gattRateLimitState = new Map();
const gattSseTickets = new Map();

function parseMsgIdList(raw, fallback) {
  if (!raw) {
    return fallback;
  }
  const values = String(raw)
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value));
  return values.length > 0 ? values : fallback;
}

function buildTopic(pattern, gatewayMac) {
  return pattern.replaceAll("{gatewayMac}", gatewayMac.toUpperCase());
}

function parseJsonPayload(payloadBuffer) {
  try {
    return JSON.parse(payloadBuffer.toString());
  } catch (_error) {
    return null;
  }
}

function toGatewayMac(value) {
  return String(value || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

function isValidMac(value) {
  return /^[0-9A-F]{12}$/.test(toGatewayMac(value));
}

function pendingKey(gatewayMac, msgId, beaconMac) {
  return `${gatewayMac}:${msgId}:${beaconMac || "*"}`;
}

function resolvePendingForMessage({ gatewayMac, msgId, beaconMac, topic, payload }) {
  const exact = pendingKey(gatewayMac, msgId, beaconMac);
  const wildcard = pendingKey(gatewayMac, msgId, "*");
  for (const key of [exact, wildcard]) {
    const waiters = pendingGattReplies.get(key);
    if (!waiters || waiters.length === 0) {
      continue;
    }
    const waiter = waiters.shift();
    if (waiters.length === 0) {
      pendingGattReplies.delete(key);
    }
    waiter.resolve({ topic, payload, gatewayMac, beaconMac, matchedKey: key });
    return true;
  }
  return false;
}

function notifySseClients(eventName, payload) {
  const serialized = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of gattSseClients) {
    if (client.gatewayMac && payload.gatewayMac !== client.gatewayMac) {
      continue;
    }
    if (client.beaconMac && payload.beaconMac && payload.beaconMac !== client.beaconMac) {
      continue;
    }
    client.res.write(serialized);
  }
}

function topicMatchesPattern(topic, pattern) {
  const escaped = pattern
    .split("+")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(topic);
}

function extractGatewayMacFromTopic(topic) {
  const match = topic.match(/\/MK110\/([0-9A-Fa-f]{12})\//);
  return match ? match[1].toUpperCase() : null;
}

function extractBeaconMac(payload) {
  return toGatewayMac(payload?.data?.mac || "");
}

function issueSseTicket(username) {
  const token = crypto.randomBytes(24).toString("hex");
  gattSseTickets.set(token, {
    username,
    expiresAt: Date.now() + gattSseTicketTtlMs
  });
  return token;
}

function validateSseTicket(ticket, username) {
  const record = gattSseTickets.get(ticket);
  if (!record) {
    return false;
  }
  if (record.expiresAt < Date.now() || record.username !== username) {
    gattSseTickets.delete(ticket);
    return false;
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ticket, record] of gattSseTickets.entries()) {
    if (record.expiresAt < now) {
      gattSseTickets.delete(ticket);
    }
  }
}, 30000).unref();

gattMqttClient.on("connect", () => {
  logger.info({ topic: gattMqttPubTopicSubscribe }, "GATT MQTT connected");
  gattMqttClient.subscribe(gattMqttPubTopicSubscribe, { qos: 1 }, (error) => {
    if (error) {
      logger.error({ error }, "Failed to subscribe GATT pub_topic pattern");
    }
  });
});

gattMqttClient.on("error", (error) => {
  logger.error({ error }, "GATT MQTT error");
});

gattMqttClient.on("message", (topic, payloadBuffer) => {
  if (!topicMatchesPattern(topic, gattMqttPubTopicSubscribe)) {
    return;
  }
  const payload = parseJsonPayload(payloadBuffer);
  if (!payload || typeof payload !== "object") {
    return;
  }

  const gatewayMac = toGatewayMac(payload?.device_info?.mac || extractGatewayMacFromTopic(topic));
  const beaconMac = extractBeaconMac(payload);
  const msgId = Number(payload.msg_id);

  if (gatewayMac && Number.isInteger(msgId)) {
    resolvePendingForMessage({ gatewayMac, msgId, beaconMac, topic, payload });
  }

  notifySseClients("gatt-message", {
    type: msgId >= 3000 ? "notify" : "reply",
    topic,
    payload,
    msgId,
    gatewayMac,
    beaconMac,
    receivedAt: new Date().toISOString()
  });
});

function buildUrl(path) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${observerBaseUrl.replace(/\/$/, "")}${path}`;
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), observerTimeoutMs);

  try {
    const response = await fetch(buildUrl(path), {
      signal: controller.signal
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "missing_token" });
  }

  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch (error) {
    return res.status(401).json({ error: "invalid_token" });
  }
}

function authenticateSseTicket(req, res, next) {
  const ticket = String(req.query.ticket || "");
  const username = String(req.query.username || "");
  if (!ticket || !username || !validateSseTicket(ticket, username)) {
    return res.status(401).json({ error: "invalid_stream_ticket" });
  }
  req.user = { username };
  return next();
}

function enforceGattRateLimit(req, res, next) {
  const identity = req.user?.username || req.ip || "unknown";
  const now = Date.now();
  const previous = gattRateLimitState.get(identity) || [];
  const active = previous.filter((timestamp) => now - timestamp < gattRateLimitWindowMs);
  if (active.length >= gattRateLimitMax) {
    return res.status(429).json({ error: "rate_limit_exceeded" });
  }
  active.push(now);
  gattRateLimitState.set(identity, active);
  return next();
}

function validateGattRequest(req, res) {
  const gatewayMac = toGatewayMac(req.body?.gatewayMac);
  const beaconMac = toGatewayMac(req.body?.beaconMac);

  if (!isValidMac(gatewayMac) || !isValidMac(beaconMac)) {
    res.status(400).json({ error: "invalid_mac", message: "gatewayMac y beaconMac deben tener 12 hex." });
    return null;
  }

  return {
    gatewayMac,
    beaconMac,
    password: String(req.body?.password || gattDefaultPass)
  };
}

function waitForGattReply({ gatewayMac, beaconMac, expectedMsgIds, timeoutMs = gattTimeoutMs }) {
  return new Promise((resolve, reject) => {
    const bindings = [];
    const timeout = setTimeout(() => {
      for (const key of bindings) {
        const waiters = pendingGattReplies.get(key) || [];
        const next = waiters.filter((entry) => entry.resolve !== resolver);
        if (next.length > 0) {
          pendingGattReplies.set(key, next);
        } else {
          pendingGattReplies.delete(key);
        }
      }
      reject(new Error("timeout_waiting_reply"));
    }, timeoutMs);

    const resolver = (value) => {
      clearTimeout(timeout);
      resolve(value);
    };

    for (const msgId of expectedMsgIds) {
      const key = pendingKey(gatewayMac, msgId, beaconMac);
      const waiters = pendingGattReplies.get(key) || [];
      waiters.push({ resolve: resolver });
      pendingGattReplies.set(key, waiters);
      bindings.push(key);
    }
  });
}

async function publishGattCommand({ gatewayMac, msgId, data, commandId }) {
  const topic = buildTopic(gattMqttSubTopicPattern, gatewayMac);
  const payload = {
    msg_id: msgId,
    device_info: { mac: gatewayMac },
    data
  };

  notifySseClients("gatt-request", {
    type: "request",
    commandId,
    topic,
    gatewayMac,
    beaconMac: toGatewayMac(data?.mac),
    payload,
    sentAt: new Date().toISOString()
  });

  await new Promise((resolve, reject) => {
    gattMqttClient.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return payload;
}

async function executeGattCommand(req, res, commandConfig) {
  const parsed = validateGattRequest(req, res);
  if (!parsed) {
    return;
  }

  if (!gattMqttClient.connected) {
    return res.status(503).json({ error: "mqtt_not_connected" });
  }

  const commandId = crypto.randomBytes(8).toString("hex");

  try {
    const commandData = commandConfig.buildData(parsed);
    const waitForReply = waitForGattReply({
      gatewayMac: parsed.gatewayMac,
      beaconMac: parsed.beaconMac,
      expectedMsgIds: commandConfig.expectedMsgIds
    });
    const requestPayload = await publishGattCommand({
      commandId,
      gatewayMac: parsed.gatewayMac,
      msgId: commandConfig.msgId,
      data: commandData
    });
    const reply = await waitForReply;

    return res.json({
      ok: true,
      commandId,
      expectedMsgIds: commandConfig.expectedMsgIds,
      request: requestPayload,
      reply
    });
  } catch (error) {
    return res.status(504).json({
      ok: false,
      commandId,
      expectedMsgIds: commandConfig.expectedMsgIds,
      error: error.message || "gatt_command_failed"
    });
  }
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/login", (req, res) => {
  if (!jwtSecret || !uiUser || !uiPassword) {
    return res.status(500).json({ error: "auth_not_configured" });
  }
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "missing_credentials" });
  }

  if (username !== uiUser || password !== uiPassword) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const token = jwt.sign({ username }, jwtSecret, { expiresIn: "8h" });
  return res.json({ token });
});

app.get("/api/status", authenticateToken, async (req, res) => {
  const [statusResult, listenersResult] = await Promise.all([
    fetchJson(observerStatusPath),
    fetchJson(observerListenersPath)
  ]);

  const reachable = statusResult.ok || listenersResult.ok;

  res.json({
    reachable,
    status: statusResult,
    listeners: listenersResult
  });
});

app.get("/api/metrics", authenticateToken, async (req, res) => {
  const metricsResult = await fetchJson(observerMetricsPath);
  res.json(metricsResult);
});

app.get("/api/diagnostics", authenticateToken, async (req, res) => {
  const clusterResult = await fetchJson(observerClusterPath);
  const tlsInfo = await checkTls(mqttHost, mqttPort, mqttDiagTimeoutMs);

  res.json({
    mqtt: tlsInfo,
    cluster: clusterResult
  });
});

app.post("/api/gatt/stream-ticket", authenticateToken, (req, res) => {
  const ticket = issueSseTicket(req.user.username);
  res.json({
    ticket,
    username: req.user.username,
    expiresInMs: gattSseTicketTtlMs
  });
});

app.get("/api/gatt/stream", authenticateSseTicket, (req, res) => {
  const gatewayMac = isValidMac(req.query.gatewayMac) ? toGatewayMac(req.query.gatewayMac) : "";
  const beaconMac = isValidMac(req.query.beaconMac) ? toGatewayMac(req.query.beaconMac) : "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const client = { res, gatewayMac, beaconMac, username: req.user.username };
  gattSseClients.add(client);

  res.write(`event: ready\ndata: ${JSON.stringify({ connected: gattMqttClient.connected })}\n\n`);

  req.on("close", () => {
    gattSseClients.delete(client);
  });
});

app.post("/api/gatt/connect", authenticateToken, enforceGattRateLimit, async (req, res) => {
  return executeGattCommand(req, res, {
    msgId: 1500,
    expectedMsgIds: gattExpectedConnectMsgIds,
    buildData: ({ beaconMac, password }) => ({ mac: beaconMac, passwd: password })
  });
});

app.post("/api/gatt/inquire-device-info", authenticateToken, enforceGattRateLimit, async (req, res) => {
  return executeGattCommand(req, res, {
    msgId: 1502,
    expectedMsgIds: gattExpectedInfoMsgIds,
    buildData: ({ beaconMac }) => ({ mac: beaconMac })
  });
});

app.post("/api/gatt/inquire-status", authenticateToken, enforceGattRateLimit, async (req, res) => {
  return executeGattCommand(req, res, {
    msgId: 1504,
    expectedMsgIds: gattExpectedStatusMsgIds,
    buildData: ({ beaconMac }) => ({ mac: beaconMac })
  });
});

function checkTls(host, portValue, timeoutMs) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port: portValue,
        servername: host,
        rejectUnauthorized: false,
        timeout: timeoutMs
      },
      () => {
        const cert = socket.getPeerCertificate();
        resolve({
          ok: true,
          host,
          port: portValue,
          authorized: socket.authorized,
          authorizationError: socket.authorizationError || null,
          certificate: cert
        });
        socket.end();
      }
    );

    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, host, port: portValue, error: "timeout" });
    });

    socket.on("error", (error) => {
      resolve({ ok: false, host, port: portValue, error: error.message });
    });
  });
}

app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "mqtt-ui-api listening");
});
