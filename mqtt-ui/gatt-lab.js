const config = window.MQTT_UI_CONFIG || { apiBaseUrl: "/mqtt-ui-api" };

const loginForm = document.getElementById("loginForm");
const loginSection = document.getElementById("loginSection");
const gattSection = document.getElementById("gattSection");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");
const gattForm = document.getElementById("gattForm");
const logsOutput = document.getElementById("logsOutput");
const streamBadge = document.getElementById("streamBadge");
const clearLogsBtn = document.getElementById("clearLogs");

let stream;

function getToken() {
  return localStorage.getItem("mqttUiToken");
}

function setToken(token) {
  if (token) {
    localStorage.setItem("mqttUiToken", token);
  } else {
    localStorage.removeItem("mqttUiToken");
  }
}

function normalizeMac(value) {
  return String(value || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
}

function appendLog(title, data) {
  const block = `[${new Date().toISOString()}] ${title}\n${JSON.stringify(data, null, 2)}\n\n`;
  logsOutput.textContent = logsOutput.textContent === "—" ? block : `${block}${logsOutput.textContent}`;
}

function setLoggedIn(isLoggedIn) {
  loginSection.style.display = isLoggedIn ? "none" : "block";
  gattSection.style.display = isLoggedIn ? "block" : "none";
  logoutBtn.style.display = isLoggedIn ? "inline-block" : "none";
  if (isLoggedIn) {
    void openStream();
  } else if (stream) {
    stream.close();
    stream = null;
  }
}

async function apiRequest(path, payload) {
  const token = getToken();
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: payload ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: payload ? JSON.stringify(payload) : undefined
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `HTTP_${response.status}`);
  }
  return body;
}

function getFormPayload() {
  const formData = new FormData(gattForm);
  return {
    gatewayMac: normalizeMac(formData.get("gatewayMac")),
    beaconMac: normalizeMac(formData.get("beaconMac")),
    password: formData.get("password")
  };
}

async function handleCommand(action) {
  const payload = getFormPayload();
  appendLog(`Request (${action})`, payload);

  const endpoints = {
    connect: "/gatt/connect",
    "inquire-device-info": "/gatt/inquire-device-info",
    "inquire-status": "/gatt/inquire-status"
  };

  try {
    const response = await apiRequest(endpoints[action], payload);
    appendLog(`Reply (${action})`, response);
    await openStream();
  } catch (error) {
    appendLog(`Error (${action})`, { error: error.message });
  }
}

async function handleLogin(event) {
  event.preventDefault();
  loginError.textContent = "";
  const formData = new FormData(loginForm);
  const payload = { username: formData.get("username"), password: formData.get("password") };

  try {
    const response = await fetch(`${config.apiBaseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error("Credenciales inválidas");
    }
    const data = await response.json();
    setToken(data.token);
    setLoggedIn(true);
  } catch (_error) {
    loginError.textContent = "No se pudo iniciar sesión.";
  }
}

async function openStream() {
  if (!getToken()) {
    return;
  }

  if (stream) {
    stream.close();
  }

  const payload = getFormPayload();
  const ticketResponse = await apiRequest("/gatt/stream-ticket", {});
  const params = new URLSearchParams({
    ticket: ticketResponse.ticket,
    username: ticketResponse.username
  });

  if (payload.gatewayMac) {
    params.set("gatewayMac", payload.gatewayMac);
  }
  if (payload.beaconMac) {
    params.set("beaconMac", payload.beaconMac);
  }

  stream = new EventSource(`${config.apiBaseUrl}/gatt/stream?${params.toString()}`);

  stream.addEventListener("ready", (event) => {
    const data = JSON.parse(event.data);
    streamBadge.textContent = data.connected ? "MQTT conectado" : "MQTT desconectado";
    streamBadge.classList.toggle("ok", data.connected);
    streamBadge.classList.toggle("error", !data.connected);
  });

  stream.addEventListener("gatt-request", (event) => {
    appendLog("Request enviado", JSON.parse(event.data));
  });

  stream.addEventListener("gatt-message", (event) => {
    appendLog("Notify/Reply MQTT", JSON.parse(event.data));
  });

  stream.onerror = () => {
    streamBadge.textContent = "Sin stream";
    streamBadge.classList.remove("ok");
    streamBadge.classList.add("error");
  };
}

loginForm.addEventListener("submit", handleLogin);
logoutBtn.addEventListener("click", () => {
  setToken(null);
  setLoggedIn(false);
});

gattForm.querySelectorAll("button[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    void handleCommand(button.dataset.action);
  });
});

gattForm.addEventListener("change", () => {
  if (getToken()) {
    void openStream();
  }
});

clearLogsBtn.addEventListener("click", () => {
  logsOutput.textContent = "—";
});

setLoggedIn(Boolean(getToken()));
