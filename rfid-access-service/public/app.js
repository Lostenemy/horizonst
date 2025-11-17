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

const ecoordinaForm = document.getElementById('ecoordina-form');
const ecoordinaUrl = document.getElementById('ecoordina-url');
const ecoordinaUser = document.getElementById('ecoordina-user');
const ecoordinaToken = document.getElementById('ecoordina-token');
const ecoordinaBrand = document.getElementById('ecoordina-brand');
const ecoordinaAction = document.getElementById('ecoordina-action');
const ecoordinaActionType = document.getElementById('ecoordina-action-type');
const ecoordinaInstance = document.getElementById('ecoordina-instance');
const ecoordinaInput = document.getElementById('ecoordina-input');
const ecoordinaOutput = document.getElementById('ecoordina-output');
const ecoordinaCentro = document.getElementById('ecoordina-centro');
const ecoordinaCif = document.getElementById('ecoordina-cif');
const ecoordinaDni = document.getElementById('ecoordina-dni');
const ecoordinaNombre = document.getElementById('ecoordina-nombre');
const ecoordinaApellidos = document.getElementById('ecoordina-apellidos');
const ecoordinaPayload = document.getElementById('ecoordina-payload');
const ecoordinaError = document.getElementById('ecoordina-error');
const ecoordinaResponse = document.getElementById('ecoordina-response');
const ecoordinaResetButton = document.getElementById('ecoordina-reset');
const ecoordinaSubmitButton = document.getElementById('ecoordina-submit');

let historyData = [];
let ecoordinaDefaults = null;

const RAW_BASE_PATH = window.__RFID_BASE_PATH__ || '';
const BASE_PATH = !RAW_BASE_PATH || RAW_BASE_PATH === '/' ? '' : RAW_BASE_PATH;
const nextPage = new URLSearchParams(window.location.search).get('next');

const withBasePath = (path) => {
  if (!path) {
    return BASE_PATH || '/';
  }

  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_PATH}${normalized}` || normalized;
};

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

const buildEcoordinaData = () => {
  const payload = {
    centro_cod: ecoordinaCentro.value.trim().toUpperCase(),
    empresa_cif: ecoordinaCif.value.trim().toUpperCase(),
    trabajador_dni: ecoordinaDni.value.trim().toUpperCase()
  };

  if (ecoordinaNombre.value.trim()) {
    payload.trabajador_nombre = ecoordinaNombre.value.trim();
  }

  if (ecoordinaApellidos.value.trim()) {
    payload.trabajador_apellidos = ecoordinaApellidos.value.trim();
  }

  return payload;
};

const refreshEcoordinaPreview = () => {
  ecoordinaPayload.value = JSON.stringify({ data: buildEcoordinaData() }, null, 2);
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

const hydrateEcoordinaDefaults = (defaults) => {
  ecoordinaDefaults = defaults;
  ecoordinaUrl.value = defaults.url ?? '';
  ecoordinaUser.value = defaults.user ?? '';
  ecoordinaToken.value = defaults.token ?? '';
  ecoordinaBrand.value = defaults.brand ?? '';
  ecoordinaAction.value = defaults.action ?? '';
  ecoordinaActionType.value = defaults.actionType ?? '';
  ecoordinaInstance.value = defaults.instance ?? '';
  ecoordinaInput.value = defaults.inputFormat ?? '';
  ecoordinaOutput.value = defaults.outputFormat ?? '';
  refreshEcoordinaPreview();
};

const loadEcoordinaDefaults = async () => {
  try {
    const result = await fetchJson(withBasePath('/api/ecoordina/defaults'));
    if (result?.defaults) {
      hydrateEcoordinaDefaults(result.defaults);
    }
  } catch (error) {
    console.warn('No se pudieron cargar los valores por defecto de e-coordina', error);
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
    const data = await fetchJson(withBasePath('/api/history'));
    historyData = Array.isArray(data?.history) ? data.history : [];
    renderHistory();
  } catch (error) {
    console.error('No se pudo cargar el histórico', error);
  }
};

const checkSession = async () => {
  try {
    const session = await fetchJson(withBasePath('/api/session'), { method: 'GET' });
    if (session.authenticated) {
      sessionUsername.textContent = session.role
        ? `${session.username ?? ''} · ${session.role === 'admin' ? 'Admin' : 'Usuario'}`
        : session.username ?? '';
      if (nextPage) {
        window.location.replace(withBasePath(`/${nextPage}`));
        return;
      }
      toggleViews(true);
      await loadHistory();
      await loadEcoordinaDefaults();
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

    await fetchJson(withBasePath('/api/login'), {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    sessionUsername.textContent = username;
    usernameInput.value = '';
    passwordInput.value = '';
    if (nextPage) {
      window.location.replace(withBasePath(`/${nextPage}`));
    } else {
      toggleViews(true);
      await loadHistory();
      await loadEcoordinaDefaults();
    }
  } catch (error) {
    loginError.textContent =
      error instanceof Error ? error.message : 'No se pudo iniciar sesión. Compruebe las credenciales.';
    loginError.hidden = false;
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await fetchJson(withBasePath('/api/logout'), { method: 'POST' });
  } catch (error) {
    console.error('Error al cerrar sesión', error);
  } finally {
    toggleViews(false);
    historyData = [];
    renderHistory();
    ecoordinaDefaults = null;
    ecoordinaForm.reset();
    ecoordinaPayload.value = '';
    ecoordinaResponse.classList.add('hidden');
    ecoordinaResponse.textContent = '';
    ecoordinaError.hidden = true;
  }
});

[ecoordinaCentro, ecoordinaCif, ecoordinaDni, ecoordinaNombre, ecoordinaApellidos].forEach((input) => {
  input.addEventListener('input', refreshEcoordinaPreview);
});

ecoordinaResetButton.addEventListener('click', () => {
  if (ecoordinaDefaults) {
    hydrateEcoordinaDefaults(ecoordinaDefaults);
  }

  ecoordinaCentro.value = '';
  ecoordinaCif.value = '';
  ecoordinaDni.value = '';
  ecoordinaNombre.value = '';
  ecoordinaApellidos.value = '';
  refreshEcoordinaPreview();
  ecoordinaError.hidden = true;
  ecoordinaError.textContent = '';
  ecoordinaResponse.classList.add('hidden');
  ecoordinaResponse.textContent = '';
});

ecoordinaSubmitButton.addEventListener('click', async () => {
  ecoordinaError.hidden = true;
  ecoordinaError.textContent = '';
  ecoordinaResponse.classList.add('hidden');
  ecoordinaResponse.textContent = '';

  const centro = ecoordinaCentro.value.trim();
  const cif = ecoordinaCif.value.trim();
  const dni = ecoordinaDni.value.trim();
  const user = ecoordinaUser.value.trim();
  const token = ecoordinaToken.value.trim();

  if (!user || !token || !centro || !cif || !dni) {
    ecoordinaError.textContent = 'Debe indicar usuario, token, código de centro, CIF y DNI antes de lanzar la prueba.';
    ecoordinaError.hidden = false;
    return;
  }

  const requestBody = {
    url: ecoordinaUrl.value.trim(),
    user,
    token,
    brand: ecoordinaBrand.value.trim(),
    action: ecoordinaAction.value.trim(),
    actionType: ecoordinaActionType.value.trim(),
    instance: ecoordinaInstance.value.trim(),
    inputFormat: ecoordinaInput.value.trim(),
    outputFormat: ecoordinaOutput.value.trim(),
    ...buildEcoordinaData()
  };

  try {
    const result = await fetchJson(withBasePath('/api/ecoordina/test'), {
      method: 'POST',
      body: JSON.stringify(requestBody)
    });

    ecoordinaResponse.textContent = JSON.stringify(result, null, 2);
    ecoordinaResponse.classList.remove('hidden');
  } catch (error) {
    ecoordinaError.textContent =
      error instanceof Error ? error.message : 'No se pudo contactar con e-coordina. Revise la consola.';
    ecoordinaError.hidden = false;
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
    const result = await fetchJson(withBasePath('/api/simulate'), {
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

refreshEcoordinaPreview();

checkSession();
