import { apiGet, apiPost } from './api.js';
import { initAuthPage } from './ui.js';

const { user } = initAuthPage();
if (!user) {
  throw new Error('Usuario no autenticado');
}

const alarmForm = document.getElementById('alarmConfigForm');
const alarmMessage = document.getElementById('alarmMessage');
const deviceSelect = document.getElementById('alarmDevice');
const categorySelect = document.getElementById('alarmCategory');
const groupSelect = document.getElementById('alarmGroup');
const configsTableBody = document.querySelector('#configsTable tbody');
const configsEmpty = document.getElementById('configsEmpty');
const alarmsTableBody = document.querySelector('#alarmsTable tbody');
const alarmsEmpty = document.getElementById('alarmsEmpty');

const populateSelect = (select, data, textKey) => {
  data.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item[textKey];
    select.appendChild(option);
  });
};

const loadMetadata = async () => {
  const [devices, categories, groups] = await Promise.all([
    apiGet('/devices'),
    apiGet('/categories'),
    apiGet('/users/groups')
  ]);

  populateSelect(deviceSelect, devices, 'ble_mac');
  populateSelect(categorySelect, categories, 'name');
  populateSelect(groupSelect, groups, 'name');
};

const renderConfigs = (configs) => {
  configsTableBody.innerHTML = '';
  if (!configs.length) {
    configsEmpty.style.display = 'block';
    return;
  }
  configsEmpty.style.display = 'none';
  configs.forEach((config) => {
    const scope = config.device_id
      ? `Dispositivo #${config.device_id}`
      : config.category_id
      ? `Categoría #${config.category_id}`
      : config.place_id
      ? `Lugar heredado #${config.place_id}`
      : 'Global';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${config.name}</td>
      <td>${config.threshold_seconds}s</td>
      <td>${scope}</td>
      <td>${config.handler_group_id || '—'}</td>
      <td>${config.active ? 'Sí' : 'No'}</td>
    `;
    configsTableBody.appendChild(row);
  });
};

const renderAlarms = (alarms) => {
  alarmsTableBody.innerHTML = '';
  const activeAlarms = alarms.filter((alarm) => alarm.status !== 'RESOLVED');
  if (!activeAlarms.length) {
    alarmsEmpty.style.display = 'block';
    return;
  }
  alarmsEmpty.style.display = 'none';
  activeAlarms.forEach((alarm) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${alarm.device_name || alarm.ble_mac || 'Dispositivo'}</td>
      <td>${alarm.config_name}</td>
      <td>${alarm.status}</td>
      <td>${new Date(alarm.triggered_at).toLocaleString()}</td>
      <td></td>
    `;
    const actionsCell = row.querySelector('td:last-child');
    const ackBtn = document.createElement('button');
    ackBtn.textContent = 'Reconocer';
    ackBtn.addEventListener('click', async () => {
      try {
        await apiPost(`/alarms/${alarm.id}/acknowledge`, {});
        await refreshData();
      } catch (error) {
        alert(error.message);
      }
    });
    const resolveBtn = document.createElement('button');
    resolveBtn.textContent = 'Resolver';
    resolveBtn.addEventListener('click', async () => {
      const notes = prompt('Notas de resolución (opcional)');
      try {
        await apiPost(`/alarms/${alarm.id}/resolve`, { notes });
        await refreshData();
      } catch (error) {
        alert(error.message);
      }
    });
    const container = document.createElement('div');
    container.className = 'actions';
    container.appendChild(ackBtn);
    container.appendChild(resolveBtn);
    actionsCell.appendChild(container);
    alarmsTableBody.appendChild(row);
  });
};

const refreshData = async () => {
  const [configs, alarms] = await Promise.all([apiGet('/alarms/configs'), apiGet('/alarms')]);
  renderConfigs(configs);
  renderAlarms(alarms);
};

alarmForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  alarmMessage.style.display = 'none';
  const payload = {
    name: alarmForm.alarmName.value.trim(),
    thresholdSeconds: Number(alarmForm.alarmThreshold.value),
    deviceId: alarmForm.alarmDevice.value ? Number(alarmForm.alarmDevice.value) : null,
    categoryId: alarmForm.alarmCategory.value ? Number(alarmForm.alarmCategory.value) : null,
    handlerGroupId: alarmForm.alarmGroup.value ? Number(alarmForm.alarmGroup.value) : null
  };
  try {
    await apiPost('/alarms/configs', payload);
    alarmMessage.textContent = 'Configuración creada correctamente';
    alarmMessage.className = 'alert success';
    alarmMessage.style.display = 'block';
    alarmForm.reset();
    await refreshData();
  } catch (error) {
    alarmMessage.textContent = error.message;
    alarmMessage.className = 'alert error';
    alarmMessage.style.display = 'block';
  }
});

const init = async () => {
  try {
    await loadMetadata();
    await refreshData();
  } catch (error) {
    alarmMessage.textContent = error.message;
    alarmMessage.className = 'alert error';
    alarmMessage.style.display = 'block';
  }
};

init();
setInterval(refreshData, 20000);
