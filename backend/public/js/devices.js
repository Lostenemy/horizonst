import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction } from './ui.js';

const { user, isAdmin, isHardwareTechnician } = initAuthPage();
const canEditHardware = isAdmin || isHardwareTechnician;
if (!user) {
  throw new Error('Usuario no autenticado');
}

const form = document.getElementById('deviceCreateForm');
const messageBox = document.getElementById('deviceCreateMessage');
const ownerSelect = document.getElementById('deviceOwner');
const categorySelect = document.getElementById('deviceCategory');
const companySelect = document.getElementById('deviceCompany');
const deviceTypeSelect = document.getElementById('deviceType');
const devicesTableBody = document.querySelector('#devicesTable tbody');
const devicesEmpty = document.getElementById('devicesEmpty');

let devices = [];
let categories = [];
let owners = [];
let companies = [];

const normalizeMac = (value) => {
  if (!value) return '';
  return value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
};

const validateMac = (value) => /^[0-9A-F]{12}$/.test(normalizeMac(value));

const setSelectOptions = (select, items, placeholder) => {
  if (!select) return;
  select.innerHTML = '';
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = placeholder;
  select.appendChild(emptyOption);
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });
};

const loadMetadata = async () => {
  categories = await apiGet('/categories');
  setSelectOptions(
    categorySelect,
    categories.map((category) => ({ value: category.id, label: category.name })),
    'Sin categoría'
  );

  if (isAdmin && ownerSelect) {
    [owners, companies] = await Promise.all([apiGet('/users'), apiGet('/companies')]);
    setSelectOptions(
      ownerSelect,
      owners.map((owner) => ({ value: owner.id, label: owner.display_name || owner.email })),
      'Sin propietario'
    );
    setSelectOptions(
      companySelect,
      companies.map((company) => ({ value: company.id, label: company.name })),
      'Sin empresa (legacy)'
    );
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
    { name: 'categoryId', label: 'Categoría', type: 'select', options: getCategoryOptions() }
  ];

  if (isAdmin) {
    fields.push({ name: 'ownerId', label: 'Propietario', type: 'select', options: getOwnerOptions() });
    fields.push({ name: 'companyId', label: 'Empresa', type: 'select', options: [
      { value: '', label: 'Sin empresa (legacy)' },
      ...companies.map((company) => ({ value: company.id, label: company.name }))
    ] });
    fields.push({ name: 'deviceType', label: 'Tipo técnico', type: 'select', options: [
      { value: 'unknown', label: 'Desconocido' }, { value: 'tag', label: 'Tag' },
      { value: 'b5', label: 'B5' }, { value: 'sensor', label: 'Sensor' },
      { value: 'beacon', label: 'Beacon' }
    ] });
  }

  await openFormModal({
    title: `Editar dispositivo ${device.name || device.ble_mac}`,
    submitText: 'Guardar cambios',
    fields,
    initialValues: {
      name: device.name || '',
      description: device.description || '',
      categoryId: device.category_id ?? '',
      ownerId: device.owner_id ?? '',
      companyId: device.company_id ?? '',
      deviceType: device.device_type || 'unknown'
    },
    onSubmit: async (values) => {
      const payload = {
        name: values.name ? String(values.name).trim() : '',
        description: values.description ? String(values.description).trim() : '',
        categoryId: values.categoryId ? Number(values.categoryId) : null
      };

      if (isAdmin) {
        payload.ownerId = values.ownerId ? Number(values.ownerId) : null;
        payload.companyId = values.companyId || null;
        payload.deviceType = values.deviceType || 'unknown';
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
    const lastGateway = device.gateway_name
      ? device.gateway_name
      : device.last_gateway_id
      ? `ID ${device.last_gateway_id}`
      : '—';
    row.innerHTML = `
      <td>${device.name || 'Sin nombre'}</td>
      <td>${device.ble_mac}</td>
      <td>${device.company_name || 'Sin empresa (legacy)'}</td>
      <td>${device.device_type || 'unknown'}</td>
      <td>${device.category_name || 'Sin categoría'}</td>
      <td>${lastGateway}</td>
      <td>${device.last_rssi ?? '—'}</td>
      <td>${device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : '—'}</td>
      <td></td>
    `;

    const actionsCell = row.querySelector('td:last-child');
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'actions';

    if (canEditHardware) {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.textContent = 'Editar';
      editButton.addEventListener('click', () => handleEditDevice(device));
      actionsContainer.appendChild(editButton);
    }

    if (isAdmin) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.textContent = 'Desactivar';
      deleteButton.className = 'secondary';
      deleteButton.addEventListener('click', () => handleDeleteDevice(device));
      actionsContainer.appendChild(deleteButton);
    }

    actionsCell.appendChild(actionsContainer);
    devicesTableBody.appendChild(row);
  });
};

if (form && isAdmin) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    messageBox.style.display = 'none';

    const macInput = form.deviceMac.value.trim();
    const bleMac = normalizeMac(macInput);
    if (!validateMac(bleMac)) {
      messageBox.textContent = 'La MAC indicada no tiene un formato válido (12 caracteres hexadecimales).';
      messageBox.className = 'alert error';
      messageBox.style.display = 'block';
      return;
    }

    const payload = {
      name: form.deviceName.value.trim(),
      bleMac,
      description: form.deviceDescription.value.trim(),
      ownerId: ownerSelect && ownerSelect.value ? Number(ownerSelect.value) : null,
      categoryId: categorySelect && categorySelect.value ? Number(categorySelect.value) : null,
      companyId: companySelect && companySelect.value ? companySelect.value : null,
      deviceType: deviceTypeSelect ? deviceTypeSelect.value : 'unknown'
    };

    try {
      await apiPost('/devices', payload);
      messageBox.textContent = 'Dispositivo registrado correctamente.';
      messageBox.className = 'alert success';
      messageBox.style.display = 'block';
      form.reset();
      await loadDevices();
    } catch (error) {
      messageBox.textContent = error.message;
      messageBox.className = 'alert error';
      messageBox.style.display = 'block';
    }
  });
}

const init = async () => {
  try {
    await loadMetadata();
    await loadDevices();
  } catch (error) {
    devicesTableBody.innerHTML = `<tr><td colspan="9">${error.message}</td></tr>`;
  }
};

init();
