import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction } from './ui.js';

const { user, isAdmin } = initAuthPage();
if (!user) {
  throw new Error('Usuario no autenticado');
}

const devicesTableBody = document.querySelector('#devicesTable tbody');
const devicesEmpty = document.getElementById('devicesEmpty');
const claimForm = document.getElementById('claimForm');
const claimMessage = document.getElementById('claimMessage');

let categories = [];
let places = [];
let owners = [];
let devices = [];

const normalizeMac = (value) => {
  if (!value) return '';
  return value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
};

const validateMac = (value) => /^[0-9A-F]{12}$/.test(normalizeMac(value));

const loadDependencies = async () => {
  const [categoriesResponse, placesResponse] = await Promise.all([
    apiGet('/categories'),
    apiGet('/places')
  ]);
  categories = categoriesResponse;
  places = placesResponse;
  if (isAdmin) {
    owners = await apiGet('/users');
  }
};

const loadDevices = async () => {
  devices = await apiGet('/devices');
  renderDevices();
};

const getCategoryOptions = () => {
  const options = [{ value: '', label: 'Sin categoría' }];
  categories.forEach((category) => {
    options.push({ value: category.id, label: category.name });
  });
  return options;
};

const getPlaceOptions = () => {
  const options = [{ value: '', label: 'Sin lugar' }];
  places.forEach((place) => {
    options.push({ value: place.id, label: place.name });
  });
  return options;
};

const getOwnerOptions = () => {
  const options = [{ value: '', label: 'Sin propietario' }];
  owners.forEach((owner) => {
    options.push({ value: owner.id, label: owner.display_name || owner.email });
  });
  return options;
};

const handleEditDevice = async (device) => {
  const fields = [
    { name: 'name', label: 'Nombre', type: 'text', placeholder: 'Nombre descriptivo' },
    { name: 'description', label: 'Descripción', type: 'textarea', rows: 3, placeholder: 'Comentarios adicionales' },
    { name: 'categoryId', label: 'Categoría', type: 'select', options: getCategoryOptions() },
    { name: 'lastPlaceId', label: 'Lugar asignado', type: 'select', options: getPlaceOptions() }
  ];

  if (isAdmin) {
    fields.push({ name: 'ownerId', label: 'Propietario', type: 'select', options: getOwnerOptions() });
  }

  await openFormModal({
    title: `Editar dispositivo ${device.name || device.ble_mac}`,
    submitText: 'Guardar cambios',
    fields,
    initialValues: {
      name: device.name || '',
      description: device.description || '',
      categoryId: device.category_id ?? '',
      lastPlaceId: device.last_place_id ?? '',
      ownerId: device.owner_id ?? ''
    },
    onSubmit: async (values) => {
      const payload = {
        name: values.name ? String(values.name).trim() : '',
        description: values.description ? String(values.description).trim() : '',
        categoryId: values.categoryId ? Number(values.categoryId) : null,
        lastPlaceId: values.lastPlaceId ? Number(values.lastPlaceId) : null
      };

      if (isAdmin) {
        payload.ownerId = values.ownerId ? Number(values.ownerId) : null;
      }

      await apiPut(`/devices/${device.id}`, payload);
      await loadDevices();
    }
  });
};

const handleDeleteDevice = async (device) => {
  const confirmed = await confirmAction({
    title: 'Eliminar dispositivo',
    message: `¿Seguro que quieres eliminar el dispositivo <strong>${device.name || device.ble_mac}</strong>?`,
    confirmText: 'Eliminar'
  });
  if (!confirmed) return;
  await apiDelete(`/devices/${device.id}`);
  await loadDevices();
};

const renderDevices = () => {
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
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Editar';
    editButton.addEventListener('click', () => handleEditDevice(device));
    actionsContainer.appendChild(editButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Eliminar';
    deleteButton.className = 'secondary';
    deleteButton.addEventListener('click', () => handleDeleteDevice(device));
    actionsContainer.appendChild(deleteButton);

    actionsCell.appendChild(actionsContainer);
    devicesTableBody.appendChild(row);
  });
};

claimForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  claimMessage.style.display = 'none';
  const macInput = claimForm.claimMac.value.trim();
  const bleMac = normalizeMac(macInput);
  const name = claimForm.claimName.value.trim();

  if (!validateMac(bleMac)) {
    claimMessage.textContent = 'La MAC indicada no tiene un formato válido (12 caracteres hexadecimales).';
    claimMessage.className = 'alert error';
    claimMessage.style.display = 'block';
    return;
  }

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
    await loadDependencies();
    await loadDevices();
  } catch (error) {
    devicesTableBody.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`;
  }
};

init();
