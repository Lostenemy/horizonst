const socket = io();

const state = {
  activeInventory: new Map(),
  unregistered: new Map(),
  readings: []
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

const fmtDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('es-ES');
};

const directionBadge = (direction) => {
  if (direction === 'IN') return '<span class="badge in">ENTRA</span>';
  if (direction === 'OUT') return '<span class="badge out">SALE</span>';
  return '<span class="badge ignored">IGNORADA</span>';
};

const regBadge = (isRegistered) =>
  isRegistered
    ? '<span class="badge registered">REGISTRADA</span>'
    : '<span class="badge unregistered">NO REGISTRADA</span>';

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

  activeTableBodyEl.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${row.epc}</td>
        <td>${directionBadge(row.lastDirection)}</td>
        <td>${regBadge(row.isRegistered)}</td>
        <td>${row.lastReaderMac}${row.lastAntenna !== null ? ` / Ant ${row.lastAntenna}` : ''}</td>
        <td>${fmtDate(row.lastEventTs)}</td>
      </tr>`
    )
    .join('');
};

const renderReadings = () => {
  readingsListEl.innerHTML = state.readings
    .slice(0, 60)
    .map(
      (event) => `
      <li>
        <div><strong>${event.epc}</strong> ${directionBadge(event.direction)} ${regBadge(event.isRegistered)}</div>
        <div>Lector: ${event.readerMac}${event.antenna !== null ? ` / Ant ${event.antenna}` : ''}</div>
        <div>Hora: ${fmtDate(event.eventTs)}</div>
      </li>`
    )
    .join('');
};

const renderUnregistered = () => {
  const rows = [...state.unregistered.values()].sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
  );

  unregisteredListEl.innerHTML = rows
    .slice(0, 100)
    .map(
      (row) => `
      <li>
        <div><strong>${row.epc}</strong> ${row.isActive ? '<span class="badge in">ACTIVA</span>' : '<span class="badge out">INACTIVA</span>'}</div>
        <div>Lector: ${row.lastReaderMac}${row.lastAntenna !== null ? ` / Ant ${row.lastAntenna}` : ''}</div>
        <div>Última lectura: ${fmtDate(row.lastSeenAt)}</div>
      </li>`
    )
    .join('');
};

socket.on('connect', () => {
  mqttStatusEl.textContent = 'Realtime conectado';
  mqttStatusEl.className = 'badge in';
});

socket.on('disconnect', () => {
  mqttStatusEl.textContent = 'Realtime desconectado';
  mqttStatusEl.className = 'badge out';
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
  }

  renderActive();
  renderUnregistered();
});

setInterval(() => {
  clockEl.textContent = new Date().toLocaleString('es-ES');
}, 1000);
