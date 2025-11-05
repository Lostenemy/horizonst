import { apiGet } from './api.js';
import { initAuthPage } from './ui.js';

const startDashboard = () => {
  const { user } = initAuthPage();
  if (!user) {
    return;
  }

  const getSummaryCards = () => document.getElementById('summaryCards');
  const recentTableBody = document.querySelector('#recentDevicesTable tbody');
  const recentEmpty = document.getElementById('recentDevicesEmpty');
  const messagesContainer = document.getElementById('messagesContainer');

  const summaryCards = getSummaryCards();

  if (!summaryCards || !recentTableBody || !recentEmpty || !messagesContainer) {
    console.error('No se encontraron los contenedores del panel.');
    return;
  }

  const renderSummary = (stats) => {
    const container = getSummaryCards();
    if (!container) {
      console.error('No se encontró el contenedor del resumen para renderizar las estadísticas.');
      return;
    }
    container.innerHTML = '';
    const items = [
      { label: 'Dispositivos', value: stats.devices },
      { label: 'Gateways', value: stats.gateways },
      { label: 'Mensajes recientes', value: stats.messages },
      { label: 'Alarmas activas', value: stats.openAlarms }
    ];

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h3>${item.label}</h3><p style="font-size:2.5rem;margin:0;color:var(--secondary-color);">${item.value}</p>`;
      container.appendChild(card);
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
      const lastGateway = device.gateway_name
        ? device.gateway_name
        : device.last_gateway_id
        ? `ID ${device.last_gateway_id}`
        : '—';
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${device.name || 'Sin nombre'}</td>
        <td>${device.ble_mac}</td>
        <td>${lastGateway}</td>
        <td>${device.last_rssi ?? '—'}</td>
        <td>${device.last_battery_mv ?? '—'}</td>
        <td>${device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : '—'}</td>
      `;
      recentTableBody.appendChild(row);
    });
  };

  const renderMessages = (messages) => {
    messagesContainer.innerHTML = '';
    if (!messages.length) {
      messagesContainer.innerHTML = '<p>No se recibieron mensajes recientes.</p>';
      return;
    }

    const list = document.createElement('ul');
    list.className = 'messages-list';
    messages.slice(0, 6).forEach((message) => {
      const item = document.createElement('li');
      const receivedAt = new Date(message.received_at);
      const gateway = message.gateway_name || message.gateway_mac || 'Gateway desconocido';
      const payloadPreview = (message.payload || '').toString();
      item.innerHTML = `
        <strong>${receivedAt.toLocaleTimeString()}</strong> · ${gateway}<br />
        <span class="topic">${message.topic}</span>
        <pre>${payloadPreview.length > 140 ? `${payloadPreview.slice(0, 140)}…` : payloadPreview}</pre>
      `;
      list.appendChild(item);
    });
    messagesContainer.appendChild(list);

    const link = document.createElement('a');
    link.href = 'messages.html';
    link.className = 'button-link';
    link.textContent = 'Ver todos los mensajes';
    messagesContainer.appendChild(link);
  };

  const renderError = (message) => {
    const container = getSummaryCards();
    if (!container) {
      console.error('No se pudo mostrar el error del resumen:', message);
      return;
    }
    container.innerHTML = `<div class="alert error">${message}</div>`;
  };

  const loadData = async () => {
    try {
      const [devices, gateways, alarms, messages] = await Promise.all([
        apiGet('/devices'),
        apiGet('/gateways'),
        apiGet('/alarms'),
        apiGet('/messages')
      ]);

      renderSummary({
        devices: devices.length,
        gateways: gateways.length,
        messages: messages.length,
        openAlarms: alarms.filter((alarm) => alarm.status !== 'RESOLVED').length
      });

      const sortedDevices = devices
        .filter((device) => device.last_seen_at)
        .sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at));
      renderRecentDevices(sortedDevices);

      renderMessages(messages);
    } catch (error) {
      console.error('No se pudo cargar el resumen del panel:', error);
      renderError(error.message || 'No se pudo cargar el resumen.');
    }
  };

  loadData();
  setInterval(loadData, 20000);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startDashboard);
} else {
  startDashboard();
}
