const socket = io();

const state = {
  activeInventory: new Map(),
  unregistered: new Map(),
  readings: [],
  registeredTags: new Map()
};

const activeCountEl = document.getElementById('activeCount');
const registeredActiveCountEl = document.getElementById('registeredActiveCount');
const unregisteredActiveCountEl = document.getElementById('unregisteredActiveCount');
const readings24hEl = document.getElementById('readings24h');
const activeTableBodyEl = document.getElementById('activeTableBody');
const readingsListEl = document.getElementById('readingsList');
const unregisteredListEl = document.getElementById('unregisteredList');
const mqttStatusEl = document.getElementById('mqttStatus');
const clockEl = document.getElementById('clock');
const tagsTableBodyEl = document.getElementById('tagsTableBody');
const tagFormEl = document.getElementById('tagForm');
const tagFormMessageEl = document.getElementById('tagFormMessage');
const exportBtnEl = document.getElementById('exportBtn');
const presentationBtnEl = document.getElementById('presentationBtn');
const presentationExitBtnEl = document.getElementById('presentationExitBtn');
const footerVersionEl = document.getElementById('footerVersion');

const appVersion = document.body.dataset.appVersion || 'v1.0.0';
footerVersionEl.textContent = appVersion;


const READER_LABELS = {
  'demo-reader-01': 'Lector-Puerta-Almacén-01',
  'demo-reader-02': 'Lector-Acceso-360P',
  'demo-reader-03': 'Lector-Zona-Carga-A'
};

const readerLabel = (value) => {
  const key = String(value || '').trim().toLowerCase();
  return READER_LABELS[key] || String(value || '-');
};


const fmtDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('es-ES');
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const directionBadge = (direction) => {
  if (direction === 'IN') return '<span class="badge in">ENTRA</span>';
  if (direction === 'OUT') return '<span class="badge out">SALIDA</span>';
  return '<span class="badge ignored">IGNORADA</span>';
};

const regBadge = (isRegistered) =>
  isRegistered
    ? '<span class="badge registered">REGISTRADA</span>'
    : '<span class="badge unregistered">SIN IDENTIFICAR</span>';

const renderEmptyRow = (colspan, message) => `<tr><td colspan="${colspan}"><div class="empty-state">${message}</div></td></tr>`;
const renderEmptyList = (message) => `<li class="empty-state empty-list">${message}</li>`;
const exportExecutiveExcel = () => {
  const link = document.createElement('a');
  link.href = '/api/export/executive-report.xlsx';
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
};

exportBtnEl.addEventListener('click', exportExecutiveExcel);

const setPresentationMode = (enabled) => {
  document.body.classList.toggle('presentation-mode', enabled);
  presentationBtnEl.textContent = enabled ? 'Salir de presentación' : 'Modo presentación';
};

presentationBtnEl.addEventListener('click', () => {
  setPresentationMode(!document.body.classList.contains('presentation-mode'));
});

presentationExitBtnEl.addEventListener('click', () => setPresentationMode(false));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('presentation-mode')) {
    setPresentationMode(false);
  }
});

const renderSummary = (summary) => {
  activeCountEl.textContent = summary.activeCount;
  registeredActiveCountEl.textContent = summary.registeredActiveCount;
  unregisteredActiveCountEl.textContent = summary.unregisteredActiveCount;
  readings24hEl.textContent = summary.totalReadings24h;
};

const renderActive = () => {
  const rows = [...state.activeInventory.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  if (rows.length === 0) {
    activeTableBodyEl.innerHTML = renderEmptyRow(5, 'Sin activos detectados en este momento.');
    return;
  }

  activeTableBodyEl.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.epc)}</td>
        <td>${directionBadge(row.lastDirection)}</td>
        <td>${regBadge(row.isRegistered)}</td>
        <td>${escapeHtml(readerLabel(row.lastReaderMac))}${row.lastAntenna !== null ? ` / Ant ${row.lastAntenna}` : ''}</td>
        <td>${fmtDate(row.lastEventTs)}</td>
      </tr>`
    )
    .join('');
};

const renderReadings = () => {
  const items = state.readings.slice(0, 60);
  if (items.length === 0) {
    readingsListEl.innerHTML = renderEmptyList('Aún no se han recibido lecturas RFID.');
    return;
  }

  readingsListEl.innerHTML = items
    .map(
      (event) => `
      <li>
        <div><strong>${escapeHtml(event.epc)}</strong> ${directionBadge(event.direction)} ${regBadge(event.isRegistered)}</div>
        <div>Lector: ${escapeHtml(readerLabel(event.readerMac))}${event.antenna !== null ? ` / Ant ${event.antenna}` : ''}</div>
        <div>Hora: ${fmtDate(event.eventTs)}</div>
      </li>`
    )
    .join('');
};

const renderUnregistered = () => {
  const rows = [...state.unregistered.values()].sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
  );

  if (rows.length === 0) {
    unregisteredListEl.innerHTML = renderEmptyList('No hay activos sin identificar actualmente.');
    return;
  }

  unregisteredListEl.innerHTML = rows
    .slice(0, 100)
    .map(
      (row) => `
      <li>
        <div><strong>${escapeHtml(row.epc)}</strong> ${row.isActive ? '<span class="badge in">ACTIVA</span>' : '<span class="badge out">INACTIVA</span>'}</div>
        <div>Lector: ${escapeHtml(readerLabel(row.lastReaderMac))}${row.lastAntenna !== null ? ` / Ant ${row.lastAntenna}` : ''}</div>
        <div>Última lectura: ${fmtDate(row.lastSeenAt)}</div>
      </li>`
    )
    .join('');
};

const renderTags = () => {
  const rows = [...state.registeredTags.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (rows.length === 0) {
    tagsTableBodyEl.innerHTML = renderEmptyRow(5, 'No hay activos registrados en el sistema.');
    return;
  }

  tagsTableBodyEl.innerHTML = rows
    .map(
      (tag) => `
      <tr>
        <td>${escapeHtml(tag.epc)}</td>
        <td>${escapeHtml(tag.name || '-')}</td>
        <td>${escapeHtml(tag.description || '-')}</td>
        <td>${fmtDate(tag.createdAt)}</td>
        <td><button class="btn-danger" type="button" data-action="delete-tag" data-epc="${escapeHtml(tag.epc)}">Borrar</button></td>
      </tr>`
    )
    .join('');
};

const setFormMessage = (text, isError = false) => {
  tagFormMessageEl.textContent = text;
  tagFormMessageEl.classList.toggle('is-error', isError);
};

const loadTags = async () => {
  try {
    const response = await fetch('/api/tags?limit=1000');
    if (!response.ok) {
      throw new Error('No se pudo cargar listado de activos');
    }

    const payload = await response.json();
    state.registeredTags.clear();
    payload.items.forEach((tag) => state.registeredTags.set(tag.epc, tag));
    renderTags();
  } catch (error) {
    setFormMessage(String(error), true);
  }
};

tagFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  setFormMessage('Registrando activo...');

  const formData = new FormData(tagFormEl);
  const body = {
    epc: String(formData.get('epc') || '').trim(),
    name: String(formData.get('name') || '').trim(),
    description: String(formData.get('description') || '').trim()
  };

  try {
    const response = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'No se pudo registrar el activo');
    }

    state.registeredTags.set(payload.item.epc, payload.item);
    renderTags();
    tagFormEl.reset();
    setFormMessage(`Activo ${payload.item.epc} registrado correctamente.`);
  } catch (error) {
    setFormMessage(String(error), true);
  }
});


tagsTableBodyEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const actionButton = target.closest('[data-action="delete-tag"]');
  if (!(actionButton instanceof HTMLButtonElement)) return;

  const epc = actionButton.dataset.epc;
  if (!epc) return;

  const confirmed = window.confirm(`¿Seguro que quieres borrar el activo ${epc}?`);
  if (!confirmed) return;

  actionButton.disabled = true;

  try {
    const response = await fetch(`/api/tags/${encodeURIComponent(epc)}`, { method: 'DELETE' });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'No se pudo borrar el activo');
    }

    state.registeredTags.delete(epc);
    renderTags();
    setFormMessage(`Activo ${epc} borrado correctamente.`);
  } catch (error) {
    setFormMessage(String(error), true);
  } finally {
    actionButton.disabled = false;
  }
});

socket.on('connect', () => {
  mqttStatusEl.textContent = 'Realtime operativo';
  mqttStatusEl.className = 'badge realtime in pulse';
});

socket.on('disconnect', () => {
  mqttStatusEl.textContent = 'Realtime sin conexión';
  mqttStatusEl.className = 'badge realtime out';
});

socket.on('dashboard:init', (payload) => {
  renderSummary(payload.summary);

  state.activeInventory.clear();
  payload.activeInventory.forEach((item) => state.activeInventory.set(item.epc, item));
  renderActive();

  state.readings = payload.lastReadings;
  renderReadings();

  state.unregistered.clear();
  payload.unregistered.forEach((item) => state.unregistered.set(item.epc, item));
  renderUnregistered();

  state.registeredTags.clear();
  payload.registeredTags.forEach((tag) => state.registeredTags.set(tag.epc, tag));
  renderTags();
});

socket.on('reading:new', (event) => {
  state.readings.unshift(event);
  state.readings = state.readings.slice(0, 200);
  renderReadings();
});

socket.on('dashboard:summary', (summary) => {
  renderSummary(summary);
});

socket.on('inventory:delta', (delta) => {
  const activeItem = {
    epc: delta.epc,
    isRegistered: delta.isRegistered,
    lastReaderMac: delta.readerMac,
    lastAntenna: delta.antenna,
    lastDirection: delta.direction,
    firstSeenAt: delta.firstSeenAt,
    lastSeenAt: delta.lastSeenAt,
    lastEventTs: delta.lastEventTs,
    updatedAt: new Date().toISOString()
  };

  if (delta.isActive) {
    state.activeInventory.set(delta.epc, activeItem);
  } else {
    state.activeInventory.delete(delta.epc);
  }

  if (!delta.isRegistered) {
    state.unregistered.set(delta.epc, {
      epc: delta.epc,
      isActive: delta.isActive,
      lastReaderMac: delta.readerMac,
      lastAntenna: delta.antenna,
      lastDirection: delta.direction,
      lastSeenAt: delta.lastSeenAt
    });
  } else {
    state.unregistered.delete(delta.epc);
  }

  renderActive();
  renderUnregistered();
});

setInterval(() => {
  clockEl.textContent = new Date().toLocaleString('es-ES');
}, 1000);

loadTags();
