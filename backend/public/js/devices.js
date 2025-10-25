import { apiGet, apiPost, getCurrentUser, clearSession } from './api.js';

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

const devicesTableBody = document.querySelector('#devicesTable tbody');
const devicesEmpty = document.getElementById('devicesEmpty');
const claimForm = document.getElementById('claimForm');
const claimMessage = document.getElementById('claimMessage');
let categories = [];

const loadCategories = async () => {
  categories = await apiGet('/categories');
};

const renderDevices = (devices) => {
  devicesTableBody.innerHTML = '';
  if (!devices.length) {
    devicesEmpty.style.display = 'block';
    return;
  }
  devicesEmpty.style.display = 'none';

  devices.forEach((device) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${device.name || 'Sin nombre'}</td>
      <td>${device.ble_mac}</td>
      <td>${device.category_name || 'Sin categoría'}</td>
      <td>${device.place_name || '—'}</td>
      <td>${device.last_rssi ?? '—'}</td>
      <td>${device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : '—'}</td>
      <td></td>
    `;
    const actionsCell = row.querySelector('td:last-child');
    const select = document.createElement('select');
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Sin categoría';
    select.appendChild(emptyOption);
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.name;
      if (category.id === device.category_id) {
        option.selected = true;
      }
      select.appendChild(option);
    });
    const button = document.createElement('button');
    button.textContent = 'Actualizar';
    button.addEventListener('click', async () => {
      try {
        await apiPost(`/devices/${device.id}/assign-category`, {
          categoryId: select.value ? Number(select.value) : null
        });
        button.textContent = 'Guardado';
        setTimeout(() => (button.textContent = 'Actualizar'), 1500);
      } catch (error) {
        alert(`No se pudo actualizar la categoría: ${error.message}`);
      }
    });
    const container = document.createElement('div');
    container.className = 'actions';
    container.appendChild(select);
    container.appendChild(button);
    actionsCell.appendChild(container);
    devicesTableBody.appendChild(row);
  });
};

const loadDevices = async () => {
  const devices = await apiGet('/devices');
  renderDevices(devices);
};

claimForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  claimMessage.style.display = 'none';
  const bleMac = claimForm.claimMac.value.trim().toUpperCase();
  const name = claimForm.claimName.value.trim();
  try {
    const result = await apiPost('/devices/claim', { bleMac, name });
    claimMessage.textContent = `Dispositivo ${result.ble_mac} asociado correctamente.`;
    claimMessage.className = 'alert success';
    claimMessage.style.display = 'block';
    claimForm.reset();
    await loadDevices();
  } catch (error) {
    claimMessage.textContent = error.message;
    claimMessage.className = 'alert error';
    claimMessage.style.display = 'block';
  }
});

const init = async () => {
  try {
    await loadCategories();
    await loadDevices();
  } catch (error) {
    devicesTableBody.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`;
  }
};

init();
