import { apiGet, apiPost } from './api.js';
import { initAuthPage } from './ui.js';

const { user, isAdmin } = initAuthPage();
if (!user) {
  throw new Error('Usuario no autenticado');
}
if (!isAdmin) {
  if (typeof window.joinBasePath === 'function') {
    window.location.href = window.joinBasePath('devices.html');
  } else {
    window.location.href = 'devices.html';
  }
}

const form = document.getElementById('deviceCreateForm');
const messageBox = document.getElementById('deviceCreateMessage');
const ownerSelect = document.getElementById('deviceOwner');
const categorySelect = document.getElementById('deviceCategory');

const normalizeMac = (value) => {
  if (!value) return '';
  return value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
};

const validateMac = (value) => /^[0-9A-F]{12}$/.test(normalizeMac(value));

const populateSelect = (select, items, getLabel) => {
  select.innerHTML = '';
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = '— Sin asignar —';
  select.appendChild(emptyOption);
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = getLabel(item);
    select.appendChild(option);
  });
};

const loadFormData = async () => {
  const [categories, owners] = await Promise.all([
    apiGet('/categories'),
    apiGet('/users')
  ]);
  populateSelect(categorySelect, categories, (category) => category.name);
  populateSelect(ownerSelect, owners, (owner) => owner.display_name || owner.email);
};

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
    ownerId: ownerSelect.value ? Number(ownerSelect.value) : null,
    categoryId: categorySelect.value ? Number(categorySelect.value) : null
  };

  try {
    await apiPost('/devices', payload);
    messageBox.textContent = 'Dispositivo registrado correctamente.';
    messageBox.className = 'alert success';
    messageBox.style.display = 'block';
    form.reset();
  } catch (error) {
    messageBox.textContent = error.message;
    messageBox.className = 'alert error';
    messageBox.style.display = 'block';
  }
});

loadFormData().catch((error) => {
  messageBox.textContent = error.message;
  messageBox.className = 'alert error';
  messageBox.style.display = 'block';
});
