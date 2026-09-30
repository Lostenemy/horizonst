import { apiGet } from './api.js';
import { initAuthPage } from './ui.js';
import { createLoadState } from './load-state.js';

const { user } = initAuthPage();
if (!user) {
  throw new Error('Usuario no autenticado');
}

const deviceSelect = document.getElementById('deviceSelect');
const loadHistoryBtn = document.getElementById('loadHistory');
const tableBody = document.querySelector('#historyTable tbody');
const emptyState = document.getElementById('historyEmpty');
let devices = [];
let historyGeneration = 0;
let selectorLoading = false;
const historyState = createLoadState({ anchor: tableBody.closest('table'), empty: emptyState,
  label: 'histórico central (hasta 500 registros)', clear: () => { tableBody.innerHTML = ''; }, onRetry: () => loadHistory() });
const selectorState = createLoadState({ anchor: deviceSelect,
  label: 'dispositivos registrados', onRetry: () => init() });

const loadDevices = async () => {
  deviceSelect.disabled = true;
  loadHistoryBtn.disabled = true;
  selectorState('loading');
  devices = await apiGet('/devices');
  deviceSelect.innerHTML = '';
  if (!devices.length) {
    deviceSelect.innerHTML = '<option>No hay dispositivos</option>';
    deviceSelect.disabled = true;
    loadHistoryBtn.disabled = true;
    selectorState('empty');
    historyState('empty');
    emptyState.textContent = 'No hay dispositivos registrados visibles en tu alcance.';
    return;
  }
  deviceSelect.disabled = false;
  loadHistoryBtn.disabled = false;
  selectorState('ready');
  devices.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.id;
    option.textContent = `${device.name || device.ble_mac} (${device.ble_mac})`;
    deviceSelect.appendChild(option);
  });
};

const loadHistory = async () => {
  const deviceId = Number(deviceSelect.value);
  if (!deviceId) return;
  const generation = ++historyGeneration;
  historyState('loading');
  try {
    const history = await apiGet(`/devices/${deviceId}/history`);
    if (generation !== historyGeneration || Number(deviceSelect.value) !== deviceId) return;
    tableBody.innerHTML = '';
    if (!history.length) {
      historyState('empty');
      emptyState.textContent = 'Sin registros en el histórico central consultado (hasta 500 registros). No representa presencia de Horneo.';
      return;
    }
    historyState('ready');
    history.forEach((entry) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${new Date(entry.recorded_at).toLocaleString()}</td>
        <td>${entry.gateway_name || entry.mac_address || '—'}</td>
        <td>${entry.rssi ?? '—'}</td>
        <td>${entry.battery_voltage_mv ?? '—'}</td>
        <td><pre style="white-space:pre-wrap;word-break:break-word;margin:0;">${entry.raw_payload || ''}</pre></td>
      `;
      tableBody.appendChild(row);
    });
  } catch (error) {
    if (generation === historyGeneration) historyState(error.status === 403 ? 'denied' : 'error', error);
  }
};

loadHistoryBtn.addEventListener('click', loadHistory);
deviceSelect.addEventListener('change', () => { historyGeneration++; historyState('ready'); tableBody.innerHTML = ''; });

const init = async () => {
  if (selectorLoading) return;
  selectorLoading = true;
  try {
  await loadDevices();
  if (devices.length) {
    await loadHistory();
  }
  } catch (error) {
    selectorState(error.status === 403 ? 'denied' : 'error', error);
    historyState('ready');
    tableBody.innerHTML = '';
  } finally { selectorLoading = false; }
};

init();
