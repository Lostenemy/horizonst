import { apiGet, apiPost, clearSession, getCurrentUser } from './api.js';

document.getElementById('logoutLink').addEventListener('click', (event) => {
  event.preventDefault();
  clearSession();
  window.location.href = '/';
});

document.getElementById('year').textContent = new Date().getFullYear();

const user = getCurrentUser();
if (!user) {
  window.location.href = '/';
}

const isAdmin = user.role === 'ADMIN';
const adminSection = document.getElementById('adminGatewaySection');
if (isAdmin) {
  adminSection.style.display = 'block';
}

const gatewayForm = document.getElementById('gatewayForm');
const gatewayMessage = document.getElementById('gatewayMessage');
const gatewaysTableBody = document.querySelector('#gatewaysTable tbody');
const gatewaysEmpty = document.getElementById('gatewaysEmpty');
let places = [];

const loadPlaces = async () => {
  places = await apiGet('/places');
};

const createPlaceSelect = (gateway) => {
  const select = document.createElement('select');
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = 'Sin lugar';
  select.appendChild(emptyOption);
  places.forEach((place) => {
    const option = document.createElement('option');
    option.value = place.id;
    option.textContent = place.name;
    if (place.id === gateway.place_id) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  return select;
};

const renderGateways = (gateways) => {
  gatewaysTableBody.innerHTML = '';
  if (!gateways.length) {
    gatewaysEmpty.style.display = 'block';
    return;
  }
  gatewaysEmpty.style.display = 'none';

  gateways.forEach((gateway) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${gateway.name || 'Sin nombre'}</td>
      <td>${gateway.mac_address}</td>
      <td>${gateway.place_name || '—'}</td>
      <td></td>
    `;
    const actionsCell = row.querySelector('td:last-child');
    const select = createPlaceSelect(gateway);
    const button = document.createElement('button');
    button.textContent = 'Asignar lugar';
    button.addEventListener('click', async () => {
      try {
        await apiPost(`/gateways/${gateway.id}/assign-place`, { placeId: select.value ? Number(select.value) : null });
        button.textContent = 'Asignado';
        setTimeout(() => (button.textContent = 'Asignar lugar'), 1500);
        await loadGateways();
      } catch (error) {
        alert(error.message);
      }
    });
    const container = document.createElement('div');
    container.className = 'actions';
    container.appendChild(select);
    container.appendChild(button);
    actionsCell.appendChild(container);
    gatewaysTableBody.appendChild(row);
  });
};

const loadGateways = async () => {
  const gateways = await apiGet('/gateways');
  renderGateways(gateways);
};

if (isAdmin) {
  gatewayForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    gatewayMessage.style.display = 'none';
    const payload = {
      name: gatewayForm.gatewayName.value.trim(),
      macAddress: gatewayForm.gatewayMac.value.trim().toUpperCase(),
      description: gatewayForm.gatewayDescription.value.trim()
    };
    try {
      await apiPost('/gateways', payload);
      gatewayMessage.textContent = 'Gateway registrada correctamente';
      gatewayMessage.className = 'alert success';
      gatewayMessage.style.display = 'block';
      gatewayForm.reset();
      await loadGateways();
    } catch (error) {
      gatewayMessage.textContent = error.message;
      gatewayMessage.className = 'alert error';
      gatewayMessage.style.display = 'block';
    }
  });
}

const init = async () => {
  try {
    await loadPlaces();
    await loadGateways();
  } catch (error) {
    gatewaysTableBody.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
  }
};

init();
