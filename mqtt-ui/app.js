const config = window.MQTT_UI_CONFIG || { apiBaseUrl: "/mqtt-ui-api" };
const loginForm = document.getElementById("loginForm");
const loginSection = document.getElementById("loginSection");
const dashboard = document.getElementById("dashboard");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

const statusOutput = document.getElementById("statusOutput");
const metricsOutput = document.getElementById("metricsOutput");
const diagnosticsOutput = document.getElementById("diagnosticsOutput");

const statusBadge = document.getElementById("statusBadge");
const metricsBadge = document.getElementById("metricsBadge");
const diagnosticsBadge = document.getElementById("diagnosticsBadge");

const refreshStatus = document.getElementById("refreshStatus");
const refreshMetrics = document.getElementById("refreshMetrics");
const refreshDiagnostics = document.getElementById("refreshDiagnostics");

function setBadge(badge, ok, label) {
  badge.textContent = label;
  badge.classList.remove("ok", "error");
  if (ok === true) {
    badge.classList.add("ok");
  }
  if (ok === false) {
    badge.classList.add("error");
  }
}

function setLoggedIn(isLoggedIn) {
  if (isLoggedIn) {
    loginSection.style.display = "none";
    dashboard.style.display = "grid";
    logoutBtn.style.display = "inline-block";
  } else {
    loginSection.style.display = "block";
    dashboard.style.display = "none";
    logoutBtn.style.display = "none";
  }
}

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

async function apiRequest(path) {
  const token = getToken();
  const response = await fetch(`${config.apiBaseUrl}${path}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    }
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function handleLogin(event) {
  event.preventDefault();
  loginError.textContent = "";
  const formData = new FormData(loginForm);
  const payload = {
    username: formData.get("username"),
    password: formData.get("password")
  };

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
    await refreshAll();
  } catch (error) {
    loginError.textContent = "No se pudo iniciar sesión.";
  }
}

async function refreshStatusData() {
  setBadge(statusBadge, null, "Cargando...");
  try {
    const data = await apiRequest("/status");
    setBadge(statusBadge, data.reachable, data.reachable ? "OK" : "KO");
    statusOutput.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    setBadge(statusBadge, false, "Error");
    statusOutput.textContent = "No se pudo obtener el estado.";
  }
}

async function refreshMetricsData() {
  setBadge(metricsBadge, null, "Cargando...");
  try {
    const data = await apiRequest("/metrics");
    setBadge(metricsBadge, data.ok, data.ok ? "OK" : "KO");
    metricsOutput.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    setBadge(metricsBadge, false, "Error");
    metricsOutput.textContent = "No se pudo obtener métricas.";
  }
}

async function refreshDiagnosticsData() {
  setBadge(diagnosticsBadge, null, "Cargando...");
  try {
    const data = await apiRequest("/diagnostics");
    const ok = data.mqtt?.ok === true;
    setBadge(diagnosticsBadge, ok, ok ? "OK" : "KO");
    diagnosticsOutput.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    setBadge(diagnosticsBadge, false, "Error");
    diagnosticsOutput.textContent = "No se pudo obtener diagnóstico.";
  }
}

async function refreshAll() {
  await Promise.all([
    refreshStatusData(),
    refreshMetricsData(),
    refreshDiagnosticsData()
  ]);
}

loginForm.addEventListener("submit", handleLogin);
refreshStatus.addEventListener("click", refreshStatusData);
refreshMetrics.addEventListener("click", refreshMetricsData);
refreshDiagnostics.addEventListener("click", refreshDiagnosticsData);

logoutBtn.addEventListener("click", () => {
  setToken(null);
  setLoggedIn(false);
});

setLoggedIn(Boolean(getToken()));
if (getToken()) {
  refreshAll();
}
