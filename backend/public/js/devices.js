import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction } from './ui.js';
import { createLoadState, createMetadataLoader } from './load-state.js';

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
let deviceTypes = [];

const normalizeMac = (value) => {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{12}|(?:[0-9a-f]{2}:){5}[0-9a-f]{2}|(?:[0-9a-f]{2}-){5}[0-9a-f]{2})$/i.test(value.trim())) return '';
  return value.trim().replace(/[:-]/g, '').toUpperCase();
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

const applyCategories = (value) => {
  categories = value;
  setSelectOptions(
    categorySelect,
    categories.map((category) => ({ value: category.id, label: category.name })),
    'Sin categoría'
  );

};
const applyOwners = (value) => {
    owners = value;
    setSelectOptions(
      ownerSelect,
      owners.map((owner) => ({ value: owner.id, label: owner.display_name || owner.email })),
      'Sin propietario'
    );
};
const applyCompanies = (value) => {
    companies = value;
    setSelectOptions(
      companySelect,
      companies.map((company) => ({ value: company.id, label: company.name })),
      'Sin empresa (legacy)'
    );
};
const refreshTypeOptions = () => {
  const company = companySelect?.value ? companies.find(item => item.id === companySelect.value) : null;
  const permitted = company ? company.permitted_device_types : null;
  const types = deviceTypes.filter(type => type.active && (!company || Array.isArray(permitted) && permitted.includes(type.code)));
  const previous = deviceTypeSelect?.value;
  setSelectOptions(deviceTypeSelect, types.map(type => ({ value: type.code, label: type.name })), types.length ? 'Selecciona un tipo' : 'Ningún tipo permitido');
  if (types.some(type => type.code === previous)) deviceTypeSelect.value = previous;
};
companySelect?.addEventListener('change', refreshTypeOptions);

const metadata = createMetadataLoader({ anchor: form, resources: [
  { key: 'categorías', load: () => apiGet('/categories'), apply: applyCategories },
  { key: 'tipos', load: () => apiGet('/device-types'), apply: value => { deviceTypes = value; } },
  ...(isAdmin ? [
    { key: 'usuarios', load: () => apiGet('/users'), apply: applyOwners },
    { key: 'compañías', load: () => apiGet('/companies'), apply: applyCompanies }
  ] : [])
], onChange: () => {
  refreshTypeOptions();
  for (const control of form.querySelectorAll('input,select,button')) control.disabled = !canEditMetadata();
  renderDevices();
} });
const canEditMetadata = () => metadata.ready('categorías') && metadata.ready('tipos')
  && (!isAdmin || (metadata.ready('usuarios') && metadata.ready('compañías')));
let loadingDevices = false;
const inventoryState = createLoadState({ anchor: devicesTableBody.closest('table'), empty: devicesEmpty,
  label: 'dispositivos registrados', clear: () => { devicesTableBody.innerHTML = ''; }, onRetry: () => loadDevices() });

const loadDevices = async () => {
  if (loadingDevices) return;
  loadingDevices = true;
  inventoryState('loading');
  try {
    devices = await apiGet('/devices');
    renderDevices();
    inventoryState(devices.length ? 'ready' : 'empty');
  } catch (error) {
    devices = [];
    inventoryState(error.status === 403 ? 'denied' : 'error', error);
  } finally { loadingDevices = false; }
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
    fields.push({ name: 'deviceType', label: 'Tipo técnico (destino debe permitirlo)', type: 'select', options:
      deviceTypes.filter(type => type.active || type.code === device.device_type).map(type => ({ value:type.code,label:`${type.name}${type.active?'':' (inactivo; conservar el actual)'}` })) });
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
    return;
  }

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
    const policy = device.type_policy;
    const typeCell = row.children[3];
    if (typeCell) typeCell.textContent = `${device.device_type || 'unknown'} · ${!policy?.known ? 'Política no disponible' : device.company_id && !policy.companyAllowed ? 'No permitido por compañía' : !policy.typeActive ? 'Tipo inactivo; uso existente conservado' : 'Tipo válido'} · ${policy?.horneoCompatible ? 'Horneo compatible' : 'Horneo no soportado'}`;

    const actionsCell = row.querySelector('td:last-child');
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'actions';

    if (canEditHardware) {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.textContent = 'Editar';
      editButton.disabled = !canEditMetadata();
      editButton.title = editButton.disabled ? 'Faltan metadatos necesarios para editar.' : '';
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

void metadata.run();
void loadDevices();
