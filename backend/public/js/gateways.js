import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction } from './ui.js';

const { user, isAdmin } = initAuthPage();
if (!user) {
  throw new Error('Usuario no autenticado');
}

const adminSection = document.getElementById('adminGatewaySection');
if (isAdmin && adminSection) {
  adminSection.style.display = 'block';
}

const gatewayForm = document.getElementById('gatewayForm');
const gatewayMessage = document.getElementById('gatewayMessage');
const gatewayOwnerSelect = document.getElementById('gatewayOwner');
const gatewaysTableBody = document.querySelector('#gatewaysTable tbody');
const gatewaysEmpty = document.getElementById('gatewaysEmpty');

let gateways = [];
let places = [];
let owners = [];

const normalizeMac = (value) => {
  if (!value) return '';
  return value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
};

const validateMac = (value) => /^[0-9A-F]{12}$/.test(normalizeMac(value));

const loadPlaces = async () => {
  places = await apiGet('/places');
};

const loadOwners = async () => {
  if (isAdmin) {
    owners = await apiGet('/users');
    if (gatewayOwnerSelect) {
      gatewayOwnerSelect.innerHTML = '';
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = '— Sin asignar —';
      gatewayOwnerSelect.appendChild(emptyOption);
      owners.forEach((owner) => {
        const option = document.createElement('option');
        option.value = owner.id;
        option.textContent = owner.display_name || owner.email;
        gatewayOwnerSelect.appendChild(option);
      });
    }
  }
};

const loadGateways = async () => {
  gateways = await apiGet('/gateways');
  renderGateways();
};

const buildPlaceSelect = (gateway) => {
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

const ownerOptions = () => {
  const options = [{ value: '', label: 'Sin propietario' }];
  owners.forEach((owner) => {
    options.push({ value: owner.id, label: owner.display_name || owner.email });
  });
  return options;
};

const handleEditGateway = async (gateway) => {
  const fields = [
    { name: 'name', label: 'Nombre', type: 'text', placeholder: 'Nombre descriptivo' },
    { name: 'description', label: 'Descripción', type: 'textarea', rows: 3, placeholder: 'Detalles' },
    { name: 'active', label: 'Activa', type: 'select', options: [
      { value: 'true', label: 'Activa' },
      { value: 'false', label: 'Inactiva' }
    ] }
  ];

  if (isAdmin) {
    fields.push({ name: 'ownerId', label: 'Propietario', type: 'select', options: ownerOptions() });
  }

  await openFormModal({
    title: `Editar gateway ${gateway.name || gateway.mac_address}`,
    submitText: 'Guardar cambios',
    fields,
    initialValues: {
      name: gateway.name || '',
      description: gateway.description || '',
      active: gateway.active ? 'true' : 'false',
      ownerId: gateway.owner_id ?? ''
    },
    onSubmit: async (values) => {
      const payload = {
        name: values.name ? String(values.name).trim() : '',
        description: values.description ? String(values.description).trim() : '',
        active: values.active
      };
      if (isAdmin) {
        payload.ownerId = values.ownerId ? Number(values.ownerId) : null;
      }
      await apiPut(`/gateways/${gateway.id}`, payload);
      await loadGateways();
    }
  });
};

const handleDeleteGateway = async (gateway) => {
  const confirmed = await confirmAction({
    title: 'Eliminar gateway',
    message: `¿Seguro que quieres eliminar la gateway <strong>${gateway.name || gateway.mac_address}</strong>?`,
    confirmText: 'Eliminar'
  });
  if (!confirmed) return;
  await apiDelete(`/gateways/${gateway.id}`);
  await loadGateways();
};

const renderGateways = () => {
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
    const container = document.createElement('div');
    container.className = 'actions';

    const select = buildPlaceSelect(gateway);
    container.appendChild(select);

    const assignButton = document.createElement('button');
    assignButton.type = 'button';
    assignButton.textContent = 'Asignar lugar';
    assignButton.addEventListener('click', async () => {
      try {
        const payload = { placeId: select.value ? Number(select.value) : null };
        await apiPost(`/gateways/${gateway.id}/assign-place`, payload);
        assignButton.textContent = 'Guardado';
        setTimeout(() => (assignButton.textContent = 'Asignar lugar'), 1500);
        await loadGateways();
      } catch (error) {
        alert(error.message);
      }
    });
    container.appendChild(assignButton);

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Editar';
    editButton.addEventListener('click', () => handleEditGateway(gateway));
    container.appendChild(editButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Eliminar';
    deleteButton.className = 'secondary';
    deleteButton.addEventListener('click', () => handleDeleteGateway(gateway));
    container.appendChild(deleteButton);

    actionsCell.appendChild(container);
    gatewaysTableBody.appendChild(row);
  });
};

if (isAdmin) {
  gatewayForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    gatewayMessage.style.display = 'none';
    const macInput = gatewayForm.gatewayMac.value.trim();
    const macAddress = normalizeMac(macInput);

    if (!validateMac(macAddress)) {
      gatewayMessage.textContent = 'La MAC indicada no tiene un formato válido (12 caracteres hexadecimales).';
      gatewayMessage.className = 'alert error';
      gatewayMessage.style.display = 'block';
      return;
    }

    const payload = {
      name: gatewayForm.gatewayName.value.trim(),
      macAddress,
      description: gatewayForm.gatewayDescription.value.trim(),
      ownerId: gatewayOwnerSelect && gatewayOwnerSelect.value ? Number(gatewayOwnerSelect.value) : null
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
    await Promise.all([loadPlaces(), loadOwners()]);
    await loadGateways();
  } catch (error) {
    gatewaysTableBody.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
  }
};

init();
