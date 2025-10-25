import { apiGet, clearSession, getCurrentUser } from './api.js';

document.getElementById('logoutLink').addEventListener('click', (event) => {
  event.preventDefault();
  clearSession();
  window.location.href = '/';
});

document.getElementById('year').textContent = new Date().getFullYear();

const currentUser = getCurrentUser();
if (!currentUser) {
  window.location.href = '/';
}

const summaryCards = document.getElementById('summaryCards');
const recentTableBody = document.querySelector('#recentDevicesTable tbody');
const recentEmpty = document.getElementById('recentDevicesEmpty');
const placesContainer = document.getElementById('placesContainer');

const renderSummary = (stats) => {
  summaryCards.innerHTML = '';
  const items = [
    { label: 'Dispositivos', value: stats.devices },
    { label: 'Gateways', value: stats.gateways },
    { label: 'Lugares', value: stats.places },
    { label: 'Alarmas activas', value: stats.openAlarms }
  ];

  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h3>${item.label}</h3><p style="font-size:2.5rem;margin:0;color:var(--secondary-color);">${item.value}</p>`;
    summaryCards.appendChild(card);
  });
};

const renderRecentDevices = (devices) => {
  recentTableBody.innerHTML = '';
  if (!devices.length) {
    recentEmpty.style.display = 'block';
    return;
  }
  recentEmpty.style.display = 'none';
  devices.slice(0, 10).forEach((device) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${device.name || 'Sin nombre'}</td>
      <td>${device.ble_mac}</td>
      <td>${device.place_name || 'Sin lugar'}</td>
      <td>${device.last_rssi ?? '—'}</td>
      <td>${device.last_battery_mv ?? '—'}</td>
      <td>${device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : '—'}</td>
    `;
    recentTableBody.appendChild(row);
  });
};

const renderPlaces = (places) => {
  placesContainer.innerHTML = '';
  if (!places.length) {
    placesContainer.innerHTML = '<p>No hay lugares configurados.</p>';
    return;
  }

  places.forEach((place) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${place.place_name || 'Sin lugar definido'}</h3>
      <p>Total de dispositivos: ${place.devices ? place.devices.length : 0}</p>
      <ul>
        ${(place.devices || [])
          .map(
            (device) =>
              `<li><strong>${device.name || device.ble_mac}</strong> · Último visto: ${
                device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'Sin datos'
              }</li>`
          )
          .join('')}
      </ul>
    `;
    placesContainer.appendChild(card);
  });
};

const loadData = async () => {
  try {
    const [devices, gateways, places, alarms] = await Promise.all([
      apiGet('/devices'),
      apiGet('/gateways'),
      apiGet('/places'),
      apiGet('/alarms')
    ]);

    renderSummary({
      devices: devices.length,
      gateways: gateways.length,
      places: places.length,
      openAlarms: alarms.filter((alarm) => alarm.status !== 'RESOLVED').length
    });

    const sortedDevices = devices
      .filter((device) => device.last_seen_at)
      .sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at));
    renderRecentDevices(sortedDevices);

    const grouped = await apiGet('/devices/grouped-by-place');
    renderPlaces(grouped);
  } catch (error) {
    summaryCards.innerHTML = `<div class="alert error">${error.message}</div>`;
  }
};

loadData();
