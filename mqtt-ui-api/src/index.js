import cors from "cors";
import express from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";
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

const jwtSecret = process.env.UI_JWT_SECRET || "change_me";
const uiUser = process.env.UI_ADMIN_USER || "admin";
const uiPassword = process.env.UI_ADMIN_PASSWORD || "admin";

const vmqBaseUrl = process.env.VMQ_HTTP_BASE_URL || "http://vernemq:8888/api/v1";
const vmqStatusPath = process.env.VMQ_HTTP_STATUS_PATH || "/status";
const vmqMetricsPath = process.env.VMQ_HTTP_METRICS_PATH || "/metrics";
const vmqListenersPath = process.env.VMQ_HTTP_LISTENERS_PATH || "/listeners";
const vmqClusterPath = process.env.VMQ_HTTP_CLUSTER_PATH || "/cluster";
const vmqHttpUser = process.env.VMQ_HTTP_USER || "";
const vmqHttpPassword = process.env.VMQ_HTTP_PASSWORD || "";
const vmqHttpTimeoutMs = Number.parseInt(process.env.VMQ_HTTP_TIMEOUT_MS || "4000", 10);

const mqttHost = process.env.MQTT_DIAG_HOST || "mqtt.horizonst.com.es";
const mqttPort = Number.parseInt(process.env.MQTT_DIAG_PORT || "8883", 10);
const mqttDiagTimeoutMs = Number.parseInt(process.env.MQTT_DIAG_TIMEOUT_MS || "5000", 10);

function buildUrl(path) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${vmqBaseUrl.replace(/\/$/, "")}${path}`;
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), vmqHttpTimeoutMs);

  const headers = {};
  if (vmqHttpUser && vmqHttpPassword) {
    const token = Buffer.from(`${vmqHttpUser}:${vmqHttpPassword}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  try {
    const response = await fetch(buildUrl(path), {
      headers,
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

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/login", (req, res) => {
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
    fetchJson(vmqStatusPath),
    fetchJson(vmqListenersPath)
  ]);

  const reachable = statusResult.ok || listenersResult.ok;

  res.json({
    reachable,
    status: statusResult,
    listeners: listenersResult
  });
});

app.get("/api/metrics", authenticateToken, async (req, res) => {
  const metricsResult = await fetchJson(vmqMetricsPath);
  res.json(metricsResult);
});

app.get("/api/diagnostics", authenticateToken, async (req, res) => {
  const clusterResult = await fetchJson(vmqClusterPath);
  const tlsInfo = await checkTls(mqttHost, mqttPort, mqttDiagTimeoutMs);

  res.json({
    mqtt: tlsInfo,
    cluster: clusterResult
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
