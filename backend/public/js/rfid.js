import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, confirmAction } from './ui.js';

const { isAdmin } = initAuthPage();

const form = document.getElementById('rfidCardForm');
const messageBox = document.getElementById('rfidCardMessage');
const cardsTableBody = document.querySelector('#rfidCardsTable tbody');
const cardsEmpty = document.getElementById('rfidCardsEmpty');
const logsTableBody = document.querySelector('#rfidLogsTable tbody');
const logsEmpty = document.getElementById('rfidLogsEmpty');
const refreshCardsBtn = document.getElementById('refreshCards');
const refreshLogsBtn = document.getElementById('refreshLogs');
const cancelEditBtn = document.getElementById('rfidCancelEdit');
const submitBtn = document.getElementById('rfidSubmit');
const activeCheckbox = document.getElementById('cardActive');

let cards = [];
let logs = [];
let editingId = null;

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const showMessage = (text, type = 'info') => {
  if (!messageBox) return;
  messageBox.textContent = text;
  messageBox.className = `alert ${type}`;
  messageBox.style.display = 'block';
};

const hideMessage = () => {
  if (messageBox) {
    messageBox.style.display = 'none';
  }
};

const resetForm = () => {
  if (!form) return;
  form.reset();
  if (activeCheckbox) {
    activeCheckbox.checked = true;
  }
  editingId = null;
  if (submitBtn) {
    submitBtn.textContent = 'Guardar tarjeta';
  }
  if (cancelEditBtn) {
    cancelEditBtn.style.display = 'none';
  }
};

const fillForm = (card) => {
  if (!form) return;
  form.cardUid.value = card.card_uid;
  form.dni.value = card.dni;
  form.firstName.value = card.first_name;
  form.lastName.value = card.last_name;
  form.companyName.value = card.company_name;
  form.companyCif.value = card.company_cif;
  form.centerCode.value = card.center_code;
  form.notes.value = card.notes || '';
  if (activeCheckbox) {
    activeCheckbox.checked = Boolean(card.active);
  }
  editingId = card.id;
  if (submitBtn) {
    submitBtn.textContent = 'Actualizar tarjeta';
  }
  if (cancelEditBtn) {
    cancelEditBtn.style.display = 'inline-flex';
  }
  hideMessage();
};

const renderCards = () => {
  if (!cardsTableBody) return;
  cardsTableBody.innerHTML = '';
  if (!cards.length) {
    if (cardsEmpty) cardsEmpty.style.display = 'block';
    return;
  }
  if (cardsEmpty) cardsEmpty.style.display = 'none';

  cards.forEach((card) => {
    const row = document.createElement('tr');
    const workerName = `${card.first_name} ${card.last_name}`.trim();
    row.innerHTML = `
      <td>${card.card_uid}</td>
      <td>${card.dni}</td>
      <td>${workerName || '—'}</td>
      <td>${card.company_name}<br /><small>${card.company_cif}</small></td>
      <td>${card.center_code}</td>
      <td>${card.notes || '—'}</td>
      <td><span class="status-pill ${card.active ? 'success' : 'error'}">${card.active ? 'Activa' : 'Inactiva'}</span></td>
      <td class="table-actions"></td>
    `;
    const actionsCell = row.querySelector('.table-actions');
    if (actionsCell) {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.textContent = 'Editar';
      editButton.addEventListener('click', () => fillForm(card));

      const toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      if (card.active) {
        toggleButton.textContent = 'Desactivar';
        toggleButton.className = 'secondary';
        toggleButton.addEventListener('click', () => handleDeactivate(card));
      } else {
        toggleButton.textContent = 'Activar';
        toggleButton.addEventListener('click', () => handleActivate(card));
      }

      actionsCell.appendChild(editButton);
      actionsCell.appendChild(toggleButton);
    }
    cardsTableBody.appendChild(row);
  });
};

const renderLogs = () => {
  if (!logsTableBody) return;
  logsTableBody.innerHTML = '';
  if (!logs.length) {
    if (logsEmpty) logsEmpty.style.display = 'block';
    return;
  }
  if (logsEmpty) logsEmpty.style.display = 'none';

  logs.forEach((log) => {
    const row = document.createElement('tr');
    const worker = log.first_name || log.last_name ? `${log.first_name || ''} ${log.last_name || ''}`.trim() : '—';
    const company = log.company_name || log.company_cif || '—';
    const direction = log.direction || '—';
    const statusLabel = log.access_allowed === true ? 'Autorizado' : log.access_allowed === false ? 'Denegado' : 'Desconocido';
    const statusClass = log.access_allowed === true ? 'success' : log.access_allowed === false ? 'error' : 'pending';
    const observation = log.api_error || log.api_status || '—';
    row.innerHTML = `
      <td>${formatDate(log.event_timestamp || log.created_at)}</td>
      <td>${log.card_uid}</td>
      <td>${worker}</td>
      <td>${company}</td>
      <td>${log.antenna_id || '—'}</td>
      <td>${direction}</td>
      <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
      <td>${observation}</td>
    `;
    logsTableBody.appendChild(row);
  });
};

const loadCards = async () => {
  try {
    cards = await apiGet('/rfid/cards');
    renderCards();
  } catch (error) {
    showMessage(error.message || 'No se pudieron cargar las tarjetas', 'error');
  }
};

const loadLogs = async () => {
  try {
    logs = await apiGet('/rfid/logs?limit=50');
    renderLogs();
  } catch (error) {
    if (logsEmpty) {
      logsEmpty.textContent = error.message || 'No se pudo obtener el histórico';
      logsEmpty.style.display = 'block';
    }
  }
};

const handleDeactivate = async (card) => {
  const confirmed = await confirmAction({
    title: 'Desactivar tarjeta',
    message: `¿Seguro que deseas desactivar <strong>${card.card_uid}</strong>?`,
    confirmText: 'Desactivar'
  });
  if (!confirmed) return;
  await apiDelete(`/rfid/cards/${card.id}`);
  await loadCards();
};

const handleActivate = async (card) => {
  await apiPut(`/rfid/cards/${card.id}`, { active: true });
  await loadCards();
};

if (form && isAdmin) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideMessage();
    const payload = {
      cardUid: normalizeString(form.cardUid.value),
      dni: normalizeString(form.dni.value),
      firstName: normalizeString(form.firstName.value),
      lastName: normalizeString(form.lastName.value),
      companyName: normalizeString(form.companyName.value),
      companyCif: normalizeString(form.companyCif.value),
      centerCode: normalizeString(form.centerCode.value),
      notes: normalizeString(form.notes.value),
      active: activeCheckbox ? Boolean(activeCheckbox.checked) : true
    };
    try {
      if (editingId) {
        await apiPut(`/rfid/cards/${editingId}`, payload);
        showMessage('Tarjeta actualizada correctamente', 'success');
      } else {
        await apiPost('/rfid/cards', payload);
        showMessage('Tarjeta creada correctamente', 'success');
      }
      resetForm();
      await loadCards();
    } catch (error) {
      showMessage(error.message || 'No se pudo guardar la tarjeta', 'error');
    }
  });
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener('click', () => {
    resetForm();
    hideMessage();
  });
}

if (refreshCardsBtn) {
  refreshCardsBtn.addEventListener('click', () => {
    loadCards();
  });
}

if (refreshLogsBtn) {
  refreshLogsBtn.addEventListener('click', () => {
    loadLogs();
  });
}

const init = async () => {
  if (!isAdmin) {
    if (messageBox) {
      messageBox.textContent = 'Necesitas permisos de administrador para gestionar las tarjetas RFID.';
      messageBox.className = 'alert error';
      messageBox.style.display = 'block';
    }
    if (logsEmpty) {
      logsEmpty.textContent = 'Histórico disponible solo para administradores.';
      logsEmpty.style.display = 'block';
    }
    return;
  }
  await Promise.all([loadCards(), loadLogs()]);
};

init();
