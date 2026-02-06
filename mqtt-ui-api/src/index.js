import cors from "cors";
import express from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import net from "net";
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
const gattMqttUsername = process.env.GATT_MQTT_USERNAME || "";
const gattMqttPassword = process.env.GATT_MQTT_PASSWORD || "";
const gattMqttClientId = process.env.GATT_MQTT_CLIENT_ID || `mqtt-ui-api-gatt-${Math.random().toString(16).slice(2, 10)}`;
const gattMqttSubTopicPattern = process.env.GATT_MQTT_SUB_TOPIC_PATTERN || "/MK110/{gatewayMac}/receive";
const gattMqttPubTopicSubscribe = process.env.GATT_MQTT_PUB_TOPIC_SUBSCRIBE || "/MK110/+/send";

class SimpleMqttClient {
  constructor(options) {
    this.options = options;
    this.connected = false;
    this.socket = null;
    this.readBuffer = Buffer.alloc(0);
    this.packetId = 1;
    this.handlers = { connect: [], message: [], error: [], close: [] };
    this.reconnectTimer = null;
  }

  on(eventName, handler) {
    this.handlers[eventName].push(handler);
  }

  emit(eventName, ...args) {
    for (const handler of this.handlers[eventName] || []) {
      try {
        handler(...args);
      } catch (error) {
        logger.error({ error }, "SimpleMqttClient handler failed");
      }
    }
  }

  start() {
    this.connect();
  }

  connect() {
    const socket = this.options.tls
      ? tls.connect({
          host: this.options.host,
          port: this.options.port,
          rejectUnauthorized: this.options.rejectUnauthorized
        })
      : net.connect({ host: this.options.host, port: this.options.port });

    this.socket = socket;

    socket.on("connect", () => {
      socket.write(this.buildConnectPacket());
    });

    socket.on("data", (chunk) => {
      this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
      this.processPackets();
    });

    socket.on("error", (error) => {
      this.emit("error", error);
    });

    socket.on("close", () => {
      this.connected = false;
      this.emit("close");
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }

  processPackets() {
    while (this.readBuffer.length > 2) {
      const header = this.readBuffer[0];
      const type = header >> 4;
      const { value: remainingLength, bytesUsed } = this.decodeRemainingLength(this.readBuffer, 1);
      if (remainingLength == null) {
        return;
      }
      const packetLength = 1 + bytesUsed + remainingLength;
      if (this.readBuffer.length < packetLength) {
        return;
      }
      const packet = this.readBuffer.slice(0, packetLength);
      this.readBuffer = this.readBuffer.slice(packetLength);
      this.handlePacket(type, packet.slice(1 + bytesUsed), header);
    }
  }

  handlePacket(type, body, header) {
    if (type === 2) {
      const returnCode = body[1];
      this.connected = returnCode === 0;
      if (this.connected) {
        this.emit("connect");
      } else {
        this.emit("error", new Error(`mqtt_connack_error_${returnCode}`));
      }
      return;
    }

    if (type === 3) {
      const topicLength = body.readUInt16BE(0);
      const topic = body.slice(2, 2 + topicLength).toString("utf8");
      let offset = 2 + topicLength;
      const qos = (header >> 1) & 0x03;
      if (qos > 0) {
        offset += 2;
      }
      const payload = body.slice(offset);
      this.emit("message", topic, payload);
      return;
    }

    if (type === 9 || type === 13) {
      return;
    }
  }

  decodeRemainingLength(buffer, offset) {
    let multiplier = 1;
    let value = 0;
    let bytesUsed = 0;
    while (offset + bytesUsed < buffer.length) {
      const encodedByte = buffer[offset + bytesUsed];
      value += (encodedByte & 127) * multiplier;
      bytesUsed += 1;
      if ((encodedByte & 128) === 0) {
        return { value, bytesUsed };
      }
      multiplier *= 128;
      if (multiplier > 128 * 128 * 128) {
        break;
      }
    }
    return { value: null, bytesUsed: 0 };
  }

  encodeString(value) {
    const payload = Buffer.from(value, "utf8");
    const len = Buffer.alloc(2);
    len.writeUInt16BE(payload.length, 0);
    return Buffer.concat([len, payload]);
  }

  encodeRemainingLength(value) {
    const bytes = [];
    let x = value;
    do {
      let encodedByte = x % 128;
      x = Math.floor(x / 128);
      if (x > 0) {
        encodedByte = encodedByte | 128;
      }
      bytes.push(encodedByte);
    } while (x > 0);
    return Buffer.from(bytes);
  }

  buildConnectPacket() {
    const protocol = this.encodeString("MQTT");
    const protocolLevel = Buffer.from([0x04]);
    let connectFlags = 0x02;
    const payloadParts = [this.encodeString(this.options.clientId)];

    if (this.options.username) {
      connectFlags |= 0x80;
      payloadParts.push(this.encodeString(this.options.username));
    }
    if (this.options.password) {
      connectFlags |= 0x40;
      payloadParts.push(this.encodeString(this.options.password));
    }

    const keepAlive = Buffer.from([0x00, 0x3c]);
    const variableHeader = Buffer.concat([protocol, protocolLevel, Buffer.from([connectFlags]), keepAlive]);
    const payload = Buffer.concat(payloadParts);
    const fixed = Buffer.concat([Buffer.from([0x10]), this.encodeRemainingLength(variableHeader.length + payload.length)]);
    return Buffer.concat([fixed, variableHeader, payload]);
  }

  subscribe(topic) {
    if (!this.connected || !this.socket) {
      throw new Error("mqtt_not_connected");
    }
    const topicBuffer = this.encodeString(topic);
    const packetId = this.packetId++;
    const payload = Buffer.concat([topicBuffer, Buffer.from([0x00])]);
    const header = Buffer.alloc(2);
    header.writeUInt16BE(packetId, 0);
    const fixed = Buffer.concat([Buffer.from([0x82]), this.encodeRemainingLength(header.length + payload.length)]);
    this.socket.write(Buffer.concat([fixed, header, payload]));
  }

  publish(topic, payloadText) {
    if (!this.connected || !this.socket) {
      throw new Error("mqtt_not_connected");
    }
    const topicBuffer = this.encodeString(topic);
    const payloadBuffer = Buffer.from(payloadText, "utf8");
    const fixed = Buffer.concat([Buffer.from([0x30]), this.encodeRemainingLength(topicBuffer.length + payloadBuffer.length)]);
    this.socket.write(Buffer.concat([fixed, topicBuffer, payloadBuffer]));
  }
}

const gattMqttClient = new SimpleMqttClient({
  host: gattMqttHost,
  port: gattMqttPort,
  tls: gattMqttTls,
  rejectUnauthorized: gattMqttRejectUnauthorized,
  username: gattMqttUsername || null,
  password: gattMqttPassword || null,
  clientId: gattMqttClientId
});

const pendingGattReplies = new Map();
const gattSseClients = new Set();
const gattRateLimitState = new Map();

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

gattMqttClient.on("connect", () => {
  logger.info({ topic: gattMqttPubTopicSubscribe }, "GATT MQTT connected");
  try {
    gattMqttClient.subscribe(gattMqttPubTopicSubscribe);
  } catch (error) {
    logger.error({ error }, "Failed to subscribe GATT pub_topic pattern");
  }
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
    const pendingKey = `${gatewayMac}:${msgId}`;
    const pending = pendingGattReplies.get(pendingKey);
    if (pending) {
      pending.resolve({ topic, payload, gatewayMac, beaconMac });
      pendingGattReplies.delete(pendingKey);
    }
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

gattMqttClient.start();

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
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : req.query.token;

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

function waitForGattReply(gatewayMac, expectedMsgId, timeoutMs = gattTimeoutMs) {
  return new Promise((resolve, reject) => {
    const key = `${gatewayMac}:${expectedMsgId}`;
    const timeout = setTimeout(() => {
      pendingGattReplies.delete(key);
      reject(new Error("timeout_waiting_reply"));
    }, timeoutMs);

    pendingGattReplies.set(key, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      }
    });
  });
}

async function publishGattCommand({ gatewayMac, msgId, data }) {
  const topic = buildTopic(gattMqttSubTopicPattern, gatewayMac);
  const payload = {
    msg_id: msgId,
    device_info: { mac: gatewayMac },
    data
  };

  notifySseClients("gatt-request", {
    type: "request",
    topic,
    gatewayMac,
    beaconMac: toGatewayMac(data?.mac),
    payload,
    sentAt: new Date().toISOString()
  });

  gattMqttClient.publish(topic, JSON.stringify(payload));
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

  try {
    const commandData = commandConfig.buildData(parsed);
    const waitForReply = waitForGattReply(parsed.gatewayMac, commandConfig.msgId);
    const requestPayload = await publishGattCommand({
      gatewayMac: parsed.gatewayMac,
      msgId: commandConfig.msgId,
      data: commandData
    });
    const reply = await waitForReply;

    return res.json({
      ok: true,
      request: requestPayload,
      reply
    });
  } catch (error) {
    return res.status(504).json({
      ok: false,
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

app.get("/api/gatt/stream", authenticateToken, (req, res) => {
  const gatewayMac = isValidMac(req.query.gatewayMac) ? toGatewayMac(req.query.gatewayMac) : "";
  const beaconMac = isValidMac(req.query.beaconMac) ? toGatewayMac(req.query.beaconMac) : "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const client = { res, gatewayMac, beaconMac };
  gattSseClients.add(client);

  res.write(`event: ready\ndata: ${JSON.stringify({ connected: gattMqttClient.connected })}\n\n`);

  req.on("close", () => {
    gattSseClients.delete(client);
  });
});

app.post("/api/gatt/connect", authenticateToken, enforceGattRateLimit, async (req, res) => {
  return executeGattCommand(req, res, {
    msgId: 1500,
    buildData: ({ beaconMac, password }) => ({ mac: beaconMac, passwd: password })
  });
});

app.post("/api/gatt/inquire-device-info", authenticateToken, enforceGattRateLimit, async (req, res) => {
  return executeGattCommand(req, res, {
    msgId: 1502,
    buildData: ({ beaconMac }) => ({ mac: beaconMac })
  });
});

app.post("/api/gatt/inquire-status", authenticateToken, enforceGattRateLimit, async (req, res) => {
  return executeGattCommand(req, res, {
    msgId: 1504,
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
