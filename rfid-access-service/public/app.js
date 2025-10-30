const loginView = document.getElementById('login-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const usernameInput = document.getElementById('login-username');
const passwordInput = document.getElementById('login-password');

const mainView = document.getElementById('main-view');
const sessionUsername = document.getElementById('session-username');
const logoutButton = document.getElementById('logout-button');

const simulateForm = document.getElementById('simulate-form');
const simulateError = document.getElementById('simulate-error');
const simulateResult = document.getElementById('simulate-result');
const cardInput = document.getElementById('simulate-card-id');
const macInput = document.getElementById('simulate-mac');
const timestampInput = document.getElementById('simulate-timestamp');
const additionalInput = document.getElementById('simulate-additional');

const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');

let historyData = [];

const parseJsonSafely = (raw) => {
  if (!raw || raw.trim() === '') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    throw new Error('El campo de datos adicionales no contiene un JSON válido.');
  }
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    },
    ...options
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error('La respuesta del servidor no es JSON válido.');
    }
  }

  if (!response.ok) {
    const message = data?.error || `Error ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  return data ?? {};
};

const toggleViews = (authenticated) => {
  if (authenticated) {
    loginView.classList.add('hidden');
    mainView.classList.remove('hidden');
    loginError.hidden = true;
  } else {
    loginView.classList.remove('hidden');
    mainView.classList.add('hidden');
    simulateResult.classList.add('hidden');
  }
};

const renderHistory = () => {
  historyList.innerHTML = '';

  if (!historyData.length) {
    historyEmpty.classList.remove('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');

  historyData.forEach((event) => {
    const item = document.createElement('li');
    item.className = 'history-item';

    const header = document.createElement('header');
    const decision = document.createElement('span');
    decision.className = `decision ${event.decision === 'GRANTED' ? 'granted' : 'denied'}`;
    decision.textContent = event.decision === 'GRANTED' ? 'ACCESO CONCEDIDO' : 'ACCESO DENEGADO';

    const origin = document.createElement('span');
    origin.className = 'muted';
    origin.textContent = `${new Date(event.timestamp).toLocaleString()} · Origen: ${
      event.source === 'web' ? 'interfaz web' : 'MQTT'
    }`;

    header.append(decision, origin);

    const summary = document.createElement('div');
    summary.className = 'muted';
    summary.textContent = `Tarjeta ${event.cardId} · Lector ${event.mac} · DNI ${
      event.dni ?? 'no asignado'
    }${event.reason ? ` · Motivo ${event.reason}` : ''}`;

    const publicationsTitle = document.createElement('strong');
    publicationsTitle.textContent = 'Publicaciones MQTT:';

    const publications = document.createElement('ul');
    publications.className = 'publications';

    event.publications.forEach((pub) => {
      const pubItem = document.createElement('li');
      const retainSuffix = pub.retain ? ' (retain)' : '';
      pubItem.textContent = `${pub.topic} → ${pub.payload} [QoS ${pub.qos}${retainSuffix}]`;
      publications.appendChild(pubItem);
    });

    item.append(header, summary, publicationsTitle, publications);
    historyList.appendChild(item);
  });
};

const showResult = (event) => {
  simulateResult.classList.remove('hidden', 'success', 'error');
  simulateResult.classList.add(event.decision === 'GRANTED' ? 'success' : 'error');
  simulateResult.innerHTML = '';

  const title = document.createElement('strong');
  title.textContent = event.decision === 'GRANTED' ? 'Acceso concedido' : 'Acceso denegado';

  const cardLine = document.createElement('p');
  cardLine.textContent = `Tarjeta ${event.cardId} · Lector ${event.mac}`;

  const dniLine = document.createElement('p');
  dniLine.textContent = `DNI: ${event.dni ?? 'no asignado'}`;

  simulateResult.append(title, cardLine, dniLine);

  if (event.reason) {
    const reasonLine = document.createElement('p');
    reasonLine.textContent = `Motivo: ${event.reason}`;
    simulateResult.appendChild(reasonLine);
  }

  const pubsLine = document.createElement('p');
  pubsLine.textContent = `Publicaciones enviadas: ${event.publications.length}`;
  simulateResult.appendChild(pubsLine);
};

const loadHistory = async () => {
  try {
    const data = await fetchJson('/api/history');
    historyData = Array.isArray(data?.history) ? data.history : [];
    renderHistory();
  } catch (error) {
    console.error('No se pudo cargar el histórico', error);
  }
};

const checkSession = async () => {
  try {
    const session = await fetchJson('/api/session', { method: 'GET' });
    if (session.authenticated) {
      sessionUsername.textContent = session.username ?? '';
      toggleViews(true);
      await loadHistory();
    } else {
      toggleViews(false);
    }
  } catch (error) {
    toggleViews(false);
  }
};

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  loginError.textContent = '';

  try {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    await fetchJson('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    sessionUsername.textContent = username;
    usernameInput.value = '';
    passwordInput.value = '';
    toggleViews(true);
    await loadHistory();
  } catch (error) {
    loginError.textContent =
      error instanceof Error ? error.message : 'No se pudo iniciar sesión. Compruebe las credenciales.';
    loginError.hidden = false;
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await fetchJson('/api/logout', { method: 'POST' });
  } catch (error) {
    console.error('Error al cerrar sesión', error);
  } finally {
    toggleViews(false);
    historyData = [];
    renderHistory();
  }
});

simulateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  simulateError.hidden = true;
  simulateError.textContent = '';

  const cardId = cardInput.value.trim();
  const mac = macInput.value.trim();

  if (!cardId || !mac) {
    simulateError.textContent = 'Debe indicar el ID de la tarjeta y la MAC del lector.';
    simulateError.hidden = false;
    return;
  }

  let timestamp;
  if (timestampInput.value) {
    const parsed = new Date(timestampInput.value);
    if (Number.isNaN(parsed.getTime())) {
      simulateError.textContent = 'La fecha introducida no es válida.';
      simulateError.hidden = false;
      return;
    }
    timestamp = parsed.toISOString();
  }

  let additional;
  try {
    additional = parseJsonSafely(additionalInput.value);
  } catch (error) {
    simulateError.textContent = error.message;
    simulateError.hidden = false;
    return;
  }

  try {
    const result = await fetchJson('/api/simulate', {
      method: 'POST',
      body: JSON.stringify({ cardId, mac, timestamp, additional })
    });

    await loadHistory();
    showResult(result);
  } catch (error) {
    simulateResult.classList.add('hidden');
    simulateResult.innerHTML = '';
    simulateError.textContent =
      error instanceof Error ? error.message : 'No se pudo ejecutar la simulación.';
    simulateError.hidden = false;
  }
});

checkSession();
