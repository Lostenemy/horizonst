import { apiGet } from './api.js';
import { initAuthPage } from './ui.js';

const { user } = initAuthPage();
if (!user) {
  throw new Error('Usuario no autenticado');
}

const deviceSelect = document.getElementById('deviceSelect');
const loadHistoryBtn = document.getElementById('loadHistory');
const tableBody = document.querySelector('#historyTable tbody');
const emptyState = document.getElementById('historyEmpty');
let devices = [];

const loadDevices = async () => {
  devices = await apiGet('/devices');
  deviceSelect.innerHTML = '';
  if (!devices.length) {
    deviceSelect.innerHTML = '<option>No hay dispositivos</option>';
    deviceSelect.disabled = true;
    loadHistoryBtn.disabled = true;
    return;
  }
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
  try {
    const history = await apiGet(`/devices/${deviceId}/history`);
    tableBody.innerHTML = '';
    if (!history.length) {
      emptyState.style.display = 'block';
      emptyState.textContent = 'No hay registros para este dispositivo.';
      return;
    }
    emptyState.style.display = 'none';
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
    tableBody.innerHTML = `<tr><td colspan="5">${error.message}</td></tr>`;
  }
};

loadHistoryBtn.addEventListener('click', loadHistory);

const init = async () => {
  await loadDevices();
  if (devices.length) {
    await loadHistory();
  }
};

init();
