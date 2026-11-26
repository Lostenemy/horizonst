import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction } from './ui.js';
import { createLoadState, createMetadataLoader } from './load-state.js';

if (document.getElementById('gatewayUiContract')?.content !== '20261126-2') {
  const warning = document.createElement('p');
  warning.setAttribute('role', 'alert');
  warning.textContent = 'Esta pantalla está desactualizada. Recarga la página antes de operar la gateway.';
  document.body.prepend(warning);
  throw new Error('Gateway UI contract mismatch');
}

const { user, isAdmin, isHardwareTechnician } = initAuthPage();
const canEditHardware = isAdmin || isHardwareTechnician;
if (!user) {
  throw new Error('Usuario no autenticado');
}

const adminSection = document.getElementById('adminGatewaySection');
if (adminSection) {
  adminSection.style.display = isAdmin ? 'block' : 'none';
}

const gatewayForm = document.getElementById('gatewayForm');
const gatewayMessage = document.getElementById('gatewayMessage');
const gatewayOwnerSelect = document.getElementById('gatewayOwner');
const gatewaysTableBody = document.querySelector('#gatewaysTable tbody');
const gatewaysEmpty = document.getElementById('gatewaysEmpty');
const technicalPanel = document.getElementById('gatewayTechnicalPanel');
const technicalTitle = document.getElementById('gatewayTechnicalTitle');
const technicalSummary = document.getElementById('gatewayTechnicalSummary');
const technicalActions = document.getElementById('gatewayTechnicalActions');
const bluetoothPanel = document.getElementById('gatewayBluetoothPanel');
const mqttPanel = document.getElementById('gatewayMqttPanel');
const mqttForm = document.getElementById('gatewayMqttForm');
const mqttFeedback = document.getElementById('gatewayMqttFeedback');
const mqttPresetStatus = document.getElementById('gatewayMqttPresetStatus');
const mqttSubmit = document.getElementById('gatewayMqttSubmit');
const mqttHistoryBody = document.querySelector('#gatewayMqttHistoryTable tbody');
const mqttConfirmationMac = document.getElementById('gatewayMqttConfirmationMac');
const technicalFeedback = document.getElementById('gatewayTechnicalFeedback');
const firmwareRecordButton = document.getElementById('gatewayRecordFirmware');
const firmwareClearButton = document.getElementById('gatewayClearFirmware');
const identityReadButton = document.getElementById('gatewayReadIdentity');
const bleConnectionsReadButton = document.getElementById('gatewayReadBleConnections');
const reportedIdentity = document.getElementById('gatewayReportedIdentity');
const gatewayRssi = document.getElementById('gatewayRssi');
const commandsBody = document.querySelector('#gatewayCommandsTable tbody');
const readsBody = document.querySelector('#gatewayReadsTable tbody');
const observedSettingsBody = document.querySelector('#gatewayObservedSettingsTable tbody');
const bleSnapshotBody = document.querySelector('#gatewayBleSnapshotTable tbody');
const bleSnapshotObservedAt = document.getElementById('gatewayBleSnapshotObservedAt');
const bleSnapshotEmpty = document.getElementById('gatewayBleSnapshotEmpty');
const auditBody = document.querySelector('#gatewayAuditTable tbody');
const devicesBody = document.querySelector('#gatewayDevicesTable tbody');

let gateways = [];
let owners = [];
let companies = [];
let selectedGateway = null;
let formatObservations = {};
let formatSubmitting = false;
const formatGroups = { ble_report_fields: document.getElementById('gatewayBleReportFields'), ble_parsing_options: document.getElementById('gatewayBleParsingOptions') };
const formatButtons = [...document.querySelectorAll('[data-format-apply]')];
const formatStatus = document.getElementById('gatewayBleFormatStatus');
const gatewayTabs = [...document.querySelectorAll('.gateway-tabs [role="tab"]')];
const gatewayTabPanels = [...document.querySelectorAll('[data-gateway-tab-panel]')];
const selectGatewayTab = (tab, focus = false) => {
  for (const item of gatewayTabs) { const selected = item === tab; item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1; }
  for (const panel of gatewayTabPanels) panel.hidden = panel.dataset.gatewayTabPanel !== tab.id;
  if (focus) tab.focus();
};
gatewayTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectGatewayTab(tab));
  tab.addEventListener('keydown', (event) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % gatewayTabs.length : event.key === 'ArrowLeft' ? (index + gatewayTabs.length - 1) % gatewayTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? gatewayTabs.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); selectGatewayTab(gatewayTabs[next], true); }
  });
});
const updateFormatAvailability = (showReason = true) => {
  for (const button of formatButtons) {
    const type = button.dataset.formatApply, observation = formatObservations[type];
    const ready = Boolean(selectedGateway && hasVerifiedMkgw3V2(selectedGateway) && observation && observation.gatewayId === selectedGateway.id && Date.now() - observation.receivedAt <= 60000);
    button.disabled = formatSubmitting || !ready;
    formatGroups[type].disabled = formatSubmitting || !ready;
  }
  if (!Object.keys(formatObservations).length && !formatSubmitting && showReason === true) formatStatus.textContent = 'Consulta primero la configuración correspondiente; la lectura caduca a los 60 segundos.';
};
const formatOptionLabels = {
  ble_report_fields: { timestamp: 'Fecha y hora', adv_data: 'Datos de anuncio crudos' },
  ble_parsing_options: {
    iBeacon_switch: 'iBeacon', eddystone_uid_switch: 'Eddystone UID',
    eddystone_tlm_switch: 'Eddystone TLM', eddystone_url_switch: 'Eddystone URL',
    bxp_acc_switch: 'BXP acelerómetro', bxp_th_switch: 'BXP temperatura y humedad',
    bxp_devinfo_switch: 'BXP información de dispositivo', bxp_button_switch: 'BXP Button',
    'bxp_tag&sensor_switch': 'BXP tag y sensor', mk_pir_switch: 'MK PIR',
    mk_tof_switch: 'MK ToF', nanobeacon_info_switch: 'Nanobeacon'
  }
};
const renderFormatObservation = (type, data) => {
  const group = formatGroups[type];
  group.querySelectorAll('label, p').forEach(node => node.remove());
  for (const [key, text] of Object.entries(formatOptionLabels[type])) {
    const label = document.createElement('label'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.name = key; checkbox.checked = data[key] === 1;
    label.className = 'gateway-format-option';
    label.append(checkbox, document.createTextNode(text)); group.appendChild(label);
  }
};
let b5FilterObserved = null;
let b5Capture = null;
const b5CaptureDevice = document.getElementById('gatewayB5CaptureDevice');
const b5CaptureStatus = document.getElementById('gatewayB5CaptureStatus');
const b5CaptureRefresh = document.getElementById('gatewayB5CaptureRefresh');

const mqttIntegerFields = [
  'security_type', 'port', 'qos', 'clean_session', 'keepalive', 'lwt_en', 'lwt_qos', 'lwt_retain'
];
const mqttFieldNames = ['security_type', 'host', 'port', 'client_id', 'username', 'passwd', 'sub_topic',
  'pub_topic', 'qos', 'clean_session', 'keepalive', 'lwt_en', 'lwt_qos', 'lwt_retain', 'lwt_topic', 'lwt_payload'];
let mqttPresetGeneration = 0;
let mqttPresetReady = false;
let mqttSubmitting = false;
const mqttReadPending = new Map();
const mqttReadBlocked = new Set();
const mqttReadRejections = new Map();
const mqttReadConfirming = new Set();
let mqttObservationGeneration = 0;
const mqttReadStatus = document.getElementById('gatewayMqttReadStatus');
const mqttObservedAt = document.getElementById('gatewayMqttObservedAt');
const mqttObservedValue = document.getElementById('gatewayMqttObservedValue');
const mqttRefreshObservation = document.getElementById('gatewayMqttRefreshObservation');
const mqttObservationErrorText = (code) => code === 'mqtt_observation_identity_secret_collision'
  ? 'Rechazo histórico por colisión de identidad. Se permite una nueva consulta 2030; los datos antiguos permanecen ocultos.'
  : code === 'mqtt_observation_secret_in_public_field'
    ? 'Observación oculta: un campo público contiene material de la credencial. Revisa la credencial y la configuración antes de solicitar otra lectura. No se repetirá automáticamente.'
    : 'Respuesta rechazada sin diagnóstico específico; no se conoce su causa. Se permite una nueva consulta 2030.';

const renderMqttObservation = (saved, gateway) => {
  if (['mqtt_observation_identity_secret_collision', 'mqtt_observation_secret_in_public_field',
    'mqtt_observation_invalid_response'].includes(saved.errorCode)) {
    throw Object.assign(new Error('mqtt_observation_withheld'), {status:422,code:saved.errorCode});
  }
  if (saved.source !== 'observed' || saved.correlation !== 'unverified') throw new Error('invalid_observation_contract');
  mqttObservedValue.replaceChildren();
  if (!saved.observation) { mqttObservedAt.textContent = 'Sin observación MQTT guardada.'; return; }
  const data = saved.observation.public_value;
  const names = mqttFieldNames.filter(key => key !== 'passwd');
  if (!data || Object.keys(data).sort().join(',') !== [...names].sort().join(',')
      || !Number.isFinite(Date.parse(saved.observation.observed_at))
      || !validateMqttForm({ ...data, passwd: '' }, normalizedCentralMac(gateway), false)) throw new Error('invalid_observation_contract');
  mqttObservedAt.textContent = `Última recepción guardada: ${new Date(saved.observation.observed_at).toLocaleString('es-ES')}. Correlación no verificada.`;
  for (const name of names) {
    const term = document.createElement('dt'); term.textContent = name;
    const value = document.createElement('dd'); value.textContent = String(data[name]);
    mqttObservedValue.append(term, value);
  }
};

const loadMqttObservation = async (gateway, requestRead = true, populateForm = false, confirmRecovery = false) => {
  const generation = ++mqttObservationGeneration;
  const current = () => selectedGateway?.id === gateway.id && generation === mqttObservationGeneration;
  const draft = mqttFieldNames.map(name => mqttForm.elements.namedItem(name).value).join('\u0000');
  let available = false;
  mqttReadStatus.textContent = 'Consultando disponibilidad de lectura y última observación guardada…';
  mqttObservedAt.textContent = 'Consultando última observación guardada; no es una lectura recién recibida.';
  mqttObservedValue.replaceChildren(); mqttRefreshObservation.disabled = true;
  mqttRefreshObservation.dataset.available = 'false';
  try {
    const saved = await apiGet(`/gateways/${gateway.id}/mqtt-observation`);
    if (!current()) return;
    if (saved.enabled !== true) {
      mqttReadStatus.textContent = 'Lectura MQTT deshabilitada hasta validar migración y protección de todos los consumidores.';
      mqttObservedAt.textContent = 'No se ha publicado ninguna consulta 2030.';
      return;
    }
    available = true;
    if (['mqtt_observation_identity_secret_collision', 'mqtt_observation_secret_in_public_field',
      'mqtt_observation_invalid_response'].includes(saved.errorCode) || mqttReadRejections.has(gateway.id)) {
      const code=mqttReadRejections.get(gateway.id) || saved.errorCode;
      mqttReadRejections.set(gateway.id,code);
      mqttObservedValue.replaceChildren(); mqttObservedAt.textContent = 'Observación anterior oculta por seguridad.';
      mqttReadStatus.textContent = mqttObservationErrorText(code);
      if (!requestRead) return;
    } else renderMqttObservation(saved, gateway);
    if (!requestRead) return;
    if (mqttReadBlocked.has(gateway.id) && !confirmRecovery) {
      mqttReadStatus.textContent = 'Lectura anterior de resultado incierto; repetición bloqueada. Revisión técnica necesaria.';
      return;
    }
    let pending = mqttReadPending.get(gateway.id);
    mqttReadStatus.textContent = 'Lectura 2030 en curso; sin reintentos automáticos. Los valores visibles son la última observación guardada.';
    if (!pending) {
      pending = apiPost(`/gateways/${gateway.id}/read-configuration/mqtt_configuration`, confirmRecovery ? { confirmRecovery: true } : {});
      mqttReadPending.set(gateway.id, pending);
      pending.finally(() => { if (mqttReadPending.get(gateway.id) === pending) mqttReadPending.delete(gateway.id); }).catch(() => {});
    }
    const result = await pending;
    if (!current()) return;
    if (result.status !== 'response_observed') throw new Error('invalid_read_status');
    const latest = await apiGet(`/gateways/${gateway.id}/mqtt-observation`);
    if (!current()) return;
    renderMqttObservation(latest, gateway);
    mqttReadRejections.delete(gateway.id);
    if (populateForm && latest.observation && !mqttSubmitting
        && draft === mqttFieldNames.map(name => mqttForm.elements.namedItem(name).value).join('\u0000')) {
      const data = latest.observation.public_value;
      for (const name of mqttFieldNames) mqttForm.elements.namedItem(name).value = name === 'passwd' ? '' : String(data[name]);
      mqttForm.elements.namedItem('confirmationMac').value = '';
      setMqttFormAvailability(true);
      mqttPresetStatus.textContent = `Borrador editable iniciado con datos públicos observados (${new Date(latest.observation.observed_at).toLocaleString('es-ES')}). Contraseña excluida; ningún cambio aplicado. La observación no demuestra frescura ni conexión.`;
    }
    mqttReadStatus.textContent = 'Respuesta pública recibida y guardada. Sin correlación inequívoca ni garantía de frescura.';
  } catch (error) {
    const rejected = error.status === 422 || error.code === 'mqtt_observation_recovery_required';
    if ([504, 502, 409].includes(error.status) && !rejected) mqttReadBlocked.add(gateway.id);
    if (rejected) mqttReadRejections.set(gateway.id,error.code === 'mqtt_observation_recovery_required'
      ? 'mqtt_observation_invalid_response' : error.code || 'mqtt_observation_invalid_response');
    if (current() && rejected) {
      mqttObservedValue.replaceChildren(); mqttObservedAt.textContent = 'Observación anterior oculta tras rechazo de la lectura.';
    }
    if (current()) mqttReadStatus.textContent = error.status === 504 ? 'Timeout de lectura; no se repetirá automáticamente.'
      : rejected ? mqttObservationErrorText(mqttReadRejections.get(gateway.id))
        : error.status === 409 ? 'Gateway ocupada o lectura anterior incierta; no se repite.' : 'Error de lectura. La observación guardada no es una consulta nueva.';
  } finally { if (current()) {
    mqttRefreshObservation.dataset.available = String(available);
    mqttRefreshObservation.textContent = 'Actualizar observación MQTT explícitamente';
    mqttRefreshObservation.disabled = !available || mqttReadPending.has(gateway.id)
      || mqttReadConfirming.has(gateway.id);
  } }
};
mqttRefreshObservation.addEventListener('click', async () => {
  if (!selectedGateway || mqttRefreshObservation.disabled) return;
  const gateway = selectedGateway;
  const generation = mqttObservationGeneration;
  if (mqttReadConfirming.has(gateway.id) || mqttReadPending.has(gateway.id)) return;
  mqttReadConfirming.add(gateway.id); mqttRefreshObservation.disabled = true;
  try {
    const confirmed = await confirmAction({title:'Confirmar lectura MQTT 2030',
      message:`Gateway #${gateway.id}. Se enviará un 2030. Tras un timeout anterior una respuesta tardía podría pertenecer al intento previo: no se garantiza correlación, frescura ni conexión al broker.`,
      confirmText:'Publicar una lectura 2030'});
    if (!confirmed || selectedGateway?.id !== gateway.id || generation !== mqttObservationGeneration) return;
    await loadMqttObservation(gateway, true, false, true);
  } finally {
    mqttReadConfirming.delete(gateway.id);
    if (selectedGateway?.id === gateway.id) mqttRefreshObservation.disabled = mqttRefreshObservation.dataset.available !== 'true'
      || mqttReadPending.has(gateway.id);
  }
});

const normalizedCentralMac = (gateway) => String(gateway?.mac_address || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();

const setMqttFormAvailability = (ready) => {
  mqttPresetReady = ready;
  mqttSubmit.disabled = !ready || mqttSubmitting;
  for (const name of [...mqttFieldNames, 'confirmationMac']) mqttForm.elements.namedItem(name).disabled = !ready || mqttSubmitting;
};

const applyMqttPreset = async () => {
  if (!selectedGateway || mqttSubmitting) return;
  const gateway = selectedGateway;
  const generation = ++mqttPresetGeneration;
  setMqttFormAvailability(false);
  for (const name of [...mqttFieldNames, 'confirmationMac']) mqttForm.elements.namedItem(name).value = '';
  mqttPresetStatus.textContent = 'Cargando propuesta del entorno; no se consulta la gateway…';
  mqttFeedback.textContent = '';
  try {
    const preset = await apiGet(`/gateways/${gateway.id}/mqtt-preset`);
    if (generation !== mqttPresetGeneration || selectedGateway?.id !== gateway.id) return;
    const expected = mqttFieldNames.filter(name => name !== 'passwd').sort().join(',');
    if (!preset || preset.source !== 'proposed' || !['staging', 'production'].includes(preset.environment)
        || !preset.data || Object.keys(preset.data).sort().join(',') !== expected
        || !validateMqttForm({ ...preset.data, passwd: '' }, normalizedCentralMac(gateway), false)) {
      throw new Error('Plantilla pública inválida');
    }
    for (const name of mqttFieldNames) mqttForm.elements.namedItem(name).value = name === 'passwd' ? '' : String(preset.data[name]);
    setMqttFormAvailability(true);
    mqttPresetStatus.textContent = `Propuesta del entorno ${preset.environment}: ${preset.data.host}:${preset.data.port}. No leída de la gateway.`;
  } catch {
    if (generation !== mqttPresetGeneration || selectedGateway?.id !== gateway.id) return;
    mqttPresetStatus.textContent = 'Plantilla propuesta no disponible o inválida. No se ha elegido ningún destino. Revisa la configuración del entorno y pulsa Restaurar propuesta para reintentar.';
  }
};

const mqttFormData = () => Object.fromEntries(mqttFieldNames.map((name) => {
  const value = mqttForm.elements.namedItem(name).value;
  return [name, mqttIntegerFields.includes(name) ? Number(value) : value];
}));

const validateMqttForm = (data, mac, requirePassword = true) => {
  const byteLength = (value) => new TextEncoder().encode(value).length;
  if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65535
      || !Number.isInteger(data.keepalive) || data.keepalive < 0 || data.keepalive > 65535) return false;
  if (![data.security_type, data.qos, data.clean_session, data.lwt_en, data.lwt_qos, data.lwt_retain]
    .every((value) => Number.isInteger(value))) return false;
  if (![0, 1].includes(data.security_type) || ![0, 1].includes(data.qos) || ![0, 1].includes(data.lwt_qos)
      || ![data.clean_session, data.lwt_en, data.lwt_retain].every((value) => value === 0 || value === 1)) return false;
  if ((requirePassword && !data.passwd) || byteLength(data.passwd) > 256
      || !data.host.trim() || byteLength(data.host) > 253 || /[\u0000-\u001f\u007f]/.test(data.host)
      || data.host.includes('://') || data.host.includes('/') || /\s/.test(data.host)) return false;
  if ([data.client_id, data.username].some((value) => !value.trim() || byteLength(value) > 256)) return false;
  if ([data.sub_topic, data.pub_topic, data.lwt_topic].some((topic) => !topic.trim() || byteLength(topic) > 1024
      || /[\u0000-\u001f\u007f]/.test(topic))) return false;
  if ([data.pub_topic, data.lwt_topic].some((topic) => topic.includes('#') || topic.includes('+'))) return false;
  if (byteLength(data.lwt_payload) > 4096) return false;
  try {
    const lwt = JSON.parse(data.lwt_payload);
    return Object.keys(lwt).sort().join(',') === 'data,device_info,msg_id'
      && lwt.msg_id === 3999
      && Object.keys(lwt.device_info || {}).join(',') === 'mac'
      && normalizedCentralMac({ mac_address: lwt.device_info.mac }) === mac
      && lwt.data && !Array.isArray(lwt.data) && Object.keys(lwt.data).length === 0;
  } catch {
    return false;
  }
};

const normalizeMac = (value) => {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{12}|(?:[0-9a-f]{2}:){5}[0-9a-f]{2}|(?:[0-9a-f]{2}-){5}[0-9a-f]{2})$/i.test(value.trim())) return '';
  return value.trim().replace(/[:-]/g, '').toUpperCase();
};

const validateMac = (value) => /^[0-9A-F]{12}$/.test(normalizeMac(value));
const hasVerifiedMkgw3V2 = (gateway) => (
  gateway?.product_model?.toUpperCase() === 'MKGW3'
  && /^V?2\.\d+(?:\.\d+)?$/i.test(gateway.firmware_version || '')
  && /^(?:inspection|device-info-2002):[A-Za-z0-9._/-]{8,120}$/.test(gateway.firmware_evidence || '')
) || (
  gateway?.reported_product_model?.toUpperCase() === 'MKGW3'
  && /^V?2\.\d+(?:\.\d+)?$/i.test(gateway.reported_firmware_version || '')
  && Boolean(gateway.identity_observed_at)
);

const refreshFirmwareControls = (gateway) => {
  const v2 = hasVerifiedMkgw3V2(gateway);
  document.getElementById('gatewayFirmwareControlStatus').textContent = v2
    ? 'Identidad MKGW3 V2 verificada. Consulta 2053 antes de solicitar un cambio en el filtro B5.'
    : 'Intervalo, modo de escaneo y configuración B5 deshabilitados: consulta la identidad o registra una evidencia válida de firmware MKGW3 V2.';
  document.getElementById('gatewayConfigureB5').disabled = !v2 || !b5FilterObserved || b5FilterObserved.data.double_press === 1;
  document.getElementById('gatewayConfigureB5').title = !v2 ? 'Requiere identidad MKGW3 V2 verificada.'
    : !b5FilterObserved ? 'Consulta primero el filtro BXP-Button (2053).' : b5FilterObserved.data.double_press === 1 ? 'La lectura observada ya indica doble pulsación activa.' : '';
  for (const operation of ['report-interval', 'scan-mode']) {
    bluetoothPanel.querySelector(`[data-ble-command="${operation}"]`).disabled = !v2;
  }
  for (const operation of ['filter-relation', 'phy']) {
    const select = bluetoothPanel.querySelector(`[data-ble-input="${operation}"]`);
    const dependentValue = operation === 'filter-relation' ? '8' : '4';
    select.querySelector(`option[value="${dependentValue}"]`).disabled = !v2;
    if (!v2 && select.value === dependentValue) select.value = '0';
  }
};

const loadOwners = async () => {
  owners = await apiGet('/users');
  if (gatewayOwnerSelect) {
    gatewayOwnerSelect.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Sin propietario';
    gatewayOwnerSelect.appendChild(emptyOption);
    owners.forEach((owner) => {
      const option = document.createElement('option');
      option.value = owner.id;
      option.textContent = owner.display_name || owner.email;
      gatewayOwnerSelect.appendChild(option);
    });
  }
};

const metadata = createMetadataLoader({ anchor: gatewayForm, resources: isAdmin ? [
  { key: 'usuarios', load: loadOwners, apply: () => {} },
  { key: 'compañías', load: () => apiGet('/companies'), apply: (value) => { companies = value; } }
] : [], onChange: () => renderGateways() });
let loadingGateways = false;
const inventoryState = createLoadState({ anchor: gatewaysTableBody.closest('table'), empty: gatewaysEmpty,
  label: 'gateways registradas', clear: () => { gatewaysTableBody.innerHTML = ''; }, onRetry: () => loadGateways() });
const loadGateways = async () => {
  if (loadingGateways) return;
  loadingGateways = true;
  inventoryState('loading');
  try {
    gateways = await apiGet('/gateways');
    renderGateways();
    inventoryState(gateways.length ? 'ready' : 'empty');
    if (selectedGateway) {
      const updated = gateways.find((gateway) => gateway.id === selectedGateway.id);
      if (updated) await selectGateway(updated);
      else { selectedGateway = null; technicalPanel.hidden = true; }
    }
  } catch (error) {
    gateways = [];
    selectedGateway = null;
    technicalPanel.hidden = true;
    inventoryState(error.status === 403 ? 'denied' : 'error', error);
  } finally { loadingGateways = false; }
};

const ownerLabel = (gateway) => {
  if (!gateway.owner_id) {
    return '—';
  }
  const owner = owners.find((candidate) => candidate.id === gateway.owner_id);
  if (owner) {
    return owner.display_name || owner.email;
  }
  if (gateway.owner_id === user.id) {
    return 'Tú';
  }
  return `ID ${gateway.owner_id}`;
};

const buildOwnerOptions = () => {
  const options = [{ value: '', label: 'Sin propietario' }];
  owners.forEach((owner) => {
    options.push({ value: owner.id, label: owner.display_name || owner.email });
  });
  return options;
};

const handleEditGateway = async (gateway) => {
  const fields = [
    { name: 'name', label: 'Nombre', type: 'text', placeholder: 'Nombre descriptivo' },
    { name: 'description', label: 'Descripción', type: 'textarea', rows: 3, placeholder: 'Detalles' }
  ];

  if (isAdmin) {
    fields.push({
      name: 'active',
      label: 'Estado',
      type: 'select',
      options: [
        { value: 'true', label: 'Activa' },
        { value: 'false', label: 'Inactiva' }
      ]
    });
  }
  if (isAdmin) {
    fields.push({ name: 'ownerId', label: 'Propietario', type: 'select', options: buildOwnerOptions() });
  }

  await openFormModal({
    title: `Editar gateway ${gateway.name || gateway.mac_address}`,
    submitText: 'Guardar cambios',
    fields,
    initialValues: {
      name: gateway.name || '',
      description: gateway.description || '',
      active: gateway.active ? 'true' : 'false',
      ownerId: gateway.owner_id ?? '',
    },
    onSubmit: async (values) => {
      const payload = {
        name: values.name ? String(values.name).trim() : '',
        description: values.description ? String(values.description).trim() : '',
        ...(isAdmin ? { active: values.active === 'true' } : {})
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
    message: `¿Seguro que quieres desactivar la gateway ${gateway.mac_address}?`,
    confirmText: 'Eliminar'
  });
  if (!confirmed) return;
  await apiDelete(`/gateways/${gateway.id}`);
  await loadGateways();
};

const handleAssignCompany = async (gateway) => {
  companies = await apiGet('/companies');
  const activeCompanies = companies.filter((company) => company.active);
  if (!activeCompanies.length) {
    gatewayMessage.textContent = 'Primero crea una compañía activa en la pantalla Compañías.';
    gatewayMessage.className = 'alert error';
    gatewayMessage.style.display = 'block';
    return;
  }
  await openFormModal({
    title: `Asignar compañía a ${gateway.mac_address}`,
    submitText: 'Asignar definitivamente',
    fields: [{ name: 'companyId', label: 'Compañía activa', type: 'select',
      options: activeCompanies.map((company) => ({ value: company.id, label: `${company.code} · ${company.name}` })) }],
    onSubmit: async ({ companyId }) => {
      await apiPost(`/gateways/${gateway.id}/assign-company`, { companyId });
      await loadGateways();
    }
  });
};

const renderHistory = (body, items, columns) => {
  body.replaceChildren();
  for (const [index, item] of items.entries()) {
    const row = document.createElement('tr');
    for (const column of columns) {
      const cell = document.createElement('td');
      cell.textContent = String(column(item, index) ?? '—');
      row.appendChild(cell);
    }
    body.appendChild(row);
  }
};

let technicalLoading = false;
const technicalState = createLoadState({ anchor: commandsBody.closest('table'),
  label: 'historial técnico (hasta 200 entradas por diario)',
  clear: () => {
    for (const body of [commandsBody, mqttHistoryBody, readsBody, auditBody, observedSettingsBody, bleSnapshotBody]) body.replaceChildren();
    bleSnapshotEmpty.hidden = true;
    bleSnapshotObservedAt.textContent = 'Consulta de fotografía BLE no completada.';
  }, onRetry: () => refreshTechnicalHistory() });
const refreshTechnicalHistory = async () => {
  if (!selectedGateway || document.hidden) return;
  if (technicalLoading) return;
  technicalLoading = true;
  const gatewayId = selectedGateway.id;
  technicalState('loading');
  try {
    const [commands, reads, audit, observedSettings, bleSnapshot] = await Promise.all([
      apiGet(`/gateways/${gatewayId}/commands`),
      apiGet(`/gateways/${gatewayId}/reads`),
      apiGet(`/gateways/${gatewayId}/audit`),
      apiGet(`/gateways/${gatewayId}/observed-settings`),
      apiGet(`/gateways/${gatewayId}/ble-connected-devices`)
    ]);
    if (selectedGateway?.id !== gatewayId) return;
    const commandColumns = [
      (item) => new Date(item.created_at).toLocaleString('es-ES'),
      (item) => item.command_type,
      (item) => item.msg_id,
      (item) => item.actor_name || item.actor_code || item.actor_type,
      (item) => item.destination_host ? `${item.destination_host}:${item.destination_port}` : '—',
      (item) => item.connection_state ? `${item.status} · BLE ${item.connection_state}` : item.status,
      (item) => item.result_code == null ? item.result_message : `${item.result_code}: ${item.result_message || ''}`,
      (item) => item.msg_id === 1042 && Number.isInteger(item.requested_rssi) && item.requested_rssi >= -127 && item.requested_rssi <= 0 ? `${item.requested_rssi} dBm (solicitado)` : '—'
    ];
    renderHistory(commandsBody, commands, commandColumns);
    renderHistory(mqttHistoryBody, commands.filter((item) => item.msg_id === 1030 || item.msg_id === 1000), [
      commandColumns[0], (item) => `${item.command_type} (${item.msg_id})`,
      commandColumns[3], commandColumns[4], commandColumns[5], commandColumns[6]
    ]);
    renderHistory(readsBody, reads, [
      (item) => new Date(item.created_at).toLocaleString('es-ES'),
      (item) => `${item.read_type} (${item.msg_id})`,
      (item) => item.status,
      (item) => item.response_observed_at ? new Date(item.response_observed_at).toLocaleString('es-ES') : item.error_message
    ]);
    renderHistory(auditBody, audit, [
      (item) => new Date(item.created_at).toLocaleString('es-ES'),
      (item) => item.action,
      (item) => item.result,
      (item) => item.actor_user_id ?? item.actor_code
    ]);
    renderHistory(observedSettingsBody, observedSettings, [
      (item) => `${item.read_type} (${item.msg_id})`,
      (item) => JSON.stringify(item.observed_value),
      (item) => new Date(item.observed_at).toLocaleString('es-ES')
    ]);
    bleSnapshotBody.replaceChildren();
    bleSnapshotEmpty.hidden = true;
    if (!bleSnapshot) {
      bleSnapshotObservedAt.textContent = 'Sin fotografía observada.';
    } else {
      bleSnapshotObservedAt.textContent = `Observada: ${new Date(bleSnapshot.observed_at).toLocaleString('es-ES')}`;
      const devices = Array.isArray(bleSnapshot.devices) ? bleSnapshot.devices : [];
      bleSnapshotEmpty.hidden = devices.length !== 0;
      renderHistory(bleSnapshotBody, devices, [
        (_item, index) => index + 1,
        (item) => item.mac,
        (item) => item.type
      ]);
    }
    technicalState('ready');
  } catch (error) {
    if (selectedGateway?.id === gatewayId) technicalState(error.status === 403 ? 'denied' : 'error', error);
  } finally {
    technicalLoading = false;
    if (selectedGateway && selectedGateway.id !== gatewayId) void refreshTechnicalHistory();
  }
};

const renderReportedIdentity = (gateway) => {
  reportedIdentity.replaceChildren();
  const values = [
    ['Nombre del dispositivo', gateway.reported_device_name], ['Modelo', gateway.reported_product_model],
    ['MAC BLE', gateway.reported_ble_mac], ['MAC Ethernet', gateway.reported_eth_mac],
    ['Fabricante', gateway.reported_company_name], ['Hardware', gateway.reported_hardware_version],
    ['Software', gateway.reported_software_version], ['Firmware', gateway.reported_firmware_version],
    ['Función', gateway.reported_function_version], ['SL BLE', gateway.reported_sl_ble_version],
    ['Observada', gateway.identity_observed_at ? new Date(gateway.identity_observed_at).toLocaleString('es-ES') : null]
  ];
  for (const [label, value] of values) {
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value || '—';
    reportedIdentity.append(term, detail);
  }
};

const selectGateway = async (gateway) => {
  selectedGateway = gateway;
  technicalPanel.hidden = true;
  formatObservations = {};
  for (const group of Object.values(formatGroups)) group.querySelectorAll('label').forEach(node => node.remove());
  if (gatewayTabs.length) selectGatewayTab(gatewayTabs[0]);
  updateFormatAvailability();
  b5FilterObserved = null;
  b5Capture = null;
  b5CaptureRefresh.disabled = true;
  b5CaptureStatus.textContent = '';
  document.querySelector('#gatewayB5CaptureTable tbody').replaceChildren();
  b5CaptureDevice.replaceChildren();
  document.getElementById('gatewayB5Diagnostic').hidden = !isAdmin || !gateway.active || !gateway.company_id;
  document.getElementById('gatewayB5DiagnosticUnavailable').hidden = !document.getElementById('gatewayB5Diagnostic').hidden;
  if (!document.getElementById('gatewayB5Diagnostic').hidden) {
    try {
      const devices = await apiGet('/devices');
      if (selectedGateway?.id !== gateway.id) return;
      for (const device of devices.filter(item => item.company_id === gateway.company_id && item.active && item.device_type === 'b5')) {
        const option = document.createElement('option'); option.value = String(device.id);
        option.textContent = device.name || `B5 ${device.id}`; b5CaptureDevice.append(option);
      }
      if (!b5CaptureDevice.options.length) b5CaptureStatus.textContent = 'No hay dispositivos B5 activos disponibles en esta compañía.';
    } catch { if (selectedGateway?.id !== gateway.id) return; b5CaptureStatus.textContent = 'No se pudo cargar la lista de dispositivos.'; }
  }
  technicalPanel.hidden = false;
  technicalTitle.textContent = gateway.name || gateway.mac_address;
  technicalSummary.textContent = `MAC ${gateway.mac_address} · ${gateway.company_name || 'Sin compañía'} · ${gateway.broker_prepared ? 'Preparada en el broker' : 'Cuenta del broker no verificada'} · conexión no verificada · ${gateway.place_name || 'Sin ubicación'} · ${gateway.active ? 'Activa' : 'Inactiva'} · registro manual: ${gateway.product_model || 'modelo desconocido'} ${gateway.firmware_version || 'firmware desconocido'}${gateway.firmware_evidence ? ` · evidencia ${gateway.firmware_evidence}` : ''}`;
  technicalActions.hidden = !canEditHardware || !gateway.active || !gateway.company_id;
  bluetoothPanel.hidden = technicalActions.hidden;
  mqttPanel.hidden = !gateway.active || !canEditHardware || (!gateway.company_id && !isAdmin);
  document.getElementById('gatewayMqttObservationPanel').hidden = !gateway.active || !canEditHardware || !gateway.company_id;
  mqttConfirmationMac.textContent = normalizedCentralMac(gateway);
  refreshFirmwareControls(gateway);
  renderReportedIdentity(gateway);
  const savedRssi = gateway.rssi_threshold;
  const validRssi = Number.isInteger(savedRssi) && savedRssi >= -127 && savedRssi <= 0;
  gatewayRssi.value = validRssi ? savedRssi : '';
  document.getElementById('gatewayRssiSaved').textContent = validRssi
    ? `Valor guardado central: ${savedRssi} dBm. No verificado mediante lectura física.`
    : 'Valor guardado central ausente o inválido. Introduce una propuesta explícita; no se usa un valor de respaldo.';
  technicalFeedback.textContent = '';
  await Promise.all([mqttPanel.hidden ? Promise.resolve() : applyMqttPreset(), refreshTechnicalHistory(), refreshGatewayDevices(gateway.id)]);
  if (!document.getElementById('gatewayMqttObservationPanel').hidden && selectedGateway?.id === gateway.id) await loadMqttObservation(gateway,true,true);
};

document.getElementById('gatewayB5CaptureStart').addEventListener('click', async () => {
  const gateway = selectedGateway;
  const deviceId = Number(b5CaptureDevice.value);
  if (!gateway || !Number.isSafeInteger(deviceId) || deviceId <= 0) { b5CaptureStatus.textContent = 'Selecciona un B5 disponible.'; return; }
  const start = document.getElementById('gatewayB5CaptureStart');
  if (start.disabled) return;
  start.disabled = true;
  try {
    const capture = await apiPost(`/gateways/${gateway.id}/b5-diagnostic-captures`, { deviceId });
    if (selectedGateway?.id !== gateway.id) return;
    b5Capture = { ...capture, deviceId, gatewayId: gateway.id };
    b5CaptureRefresh.disabled = false;
    b5CaptureStatus.textContent = `Captura activa hasta ${new Date(capture.expiresAt).toLocaleTimeString('es-ES')}. Actualiza para ver observaciones.`;
    document.querySelector('#gatewayB5CaptureTable tbody').replaceChildren();
  } catch { if (selectedGateway?.id === gateway.id) b5CaptureStatus.textContent = 'No se pudo iniciar la captura; revisa permisos y compañía.'; }
  finally { start.disabled = false; }
});
b5CaptureDevice.addEventListener('change', () => { b5Capture = null; b5CaptureRefresh.disabled = true; b5CaptureStatus.textContent = 'Selecciona Iniciar captura para el dispositivo elegido.'; });
b5CaptureRefresh.addEventListener('click', async () => {
  const capture = b5Capture;
  if (!capture || selectedGateway?.id !== capture.gatewayId) return;
  try {
    const result = await apiGet(`/gateways/${capture.gatewayId}/b5-diagnostic-captures/${encodeURIComponent(capture.id)}?deviceId=${capture.deviceId}`);
    if (b5Capture !== capture) return;
    renderHistory(document.querySelector('#gatewayB5CaptureTable tbody'), result.items, [
      item => new Date(item.receivedAt).toLocaleString('es-ES'), item => item.frameType ?? 'No disponible',
      item => item.alarmStatus ?? 'No disponible', item => item.subAlarmStatus ?? 'No disponible',
      item => item.triggerCount ?? 'No disponible', item => item.comparison
    ]);
    b5CaptureStatus.textContent = `${result.items.length} observaciones. El contador diferente no demuestra una pulsación.`;
  } catch { b5CaptureStatus.textContent = 'Captura caducada o no disponible; inicia otra si es necesario.'; b5CaptureRefresh.disabled = true; }
});

firmwareRecordButton.addEventListener('click', async () => {
  if (!selectedGateway || !canEditHardware) return;
  await openFormModal({
    title: `Registrar firmware de ${selectedGateway.mac_address}`,
    submitText: 'Registrar con evidencia',
    fields: [
      { name: 'productModel', label: 'Modelo (MKGW3)', type: 'text' },
      { name: 'firmwareVersion', label: 'Versión (por ejemplo V2.4)', type: 'text' },
      { name: 'evidence', label: 'Referencia verificable (inspection:ticket-12345678)', type: 'text' }
    ],
    initialValues: {
      productModel: selectedGateway.product_model || 'MKGW3',
      firmwareVersion: selectedGateway.firmware_version || '',
      evidence: selectedGateway.firmware_evidence || ''
    },
    onSubmit: async (values) => {
      await apiPut(`/gateways/${selectedGateway.id}/firmware`, {
        productModel: values.productModel, firmwareVersion: values.firmwareVersion, evidence: values.evidence
      });
      await loadGateways();
    }
  });
});

identityReadButton.addEventListener('click', async () => {
  if (!selectedGateway || !canEditHardware) return;
  if (!await confirmAction({
    title: 'Consultar identidad de la gateway',
    message: `Publicar la lectura 2002 para ${selectedGateway.mac_address}?`,
    confirmText: 'Consultar'
  })) return;
  try {
    technicalFeedback.textContent = 'Esperando una respuesta 2002 observada…';
    const result = await apiPost(`/gateways/${selectedGateway.id}/read-identity`, {});
    technicalFeedback.textContent = result.message;
    await loadGateways();
  } catch (error) {
    technicalFeedback.textContent = `No se pudo consultar la identidad: ${error.message}`;
    await refreshTechnicalHistory();
  }
});

bleConnectionsReadButton.addEventListener('click', async () => {
  if (!selectedGateway || !canEditHardware) return;
  if (!await confirmAction({
    title: 'Consultar dispositivos BLE conectados',
    message: `Publicar la lectura 2201 para ${selectedGateway.mac_address}? Se guardará una fotografía observada, no una confirmación B5.`,
    confirmText: 'Consultar'
  })) return;
  try {
    technicalFeedback.textContent = 'Esperando una respuesta 2201 observada…';
    const result = await apiPost(`/gateways/${selectedGateway.id}/read-ble-connected-devices`, {});
    technicalFeedback.textContent = result.message;
  } catch (error) {
    technicalFeedback.textContent = `No se pudo observar la lista BLE conectada: ${error.message}`;
  }
  await refreshTechnicalHistory();
});

for (const button of bluetoothPanel.querySelectorAll('[data-config-read]')) {
  const nearbyStatus = document.createElement('span');
  nearbyStatus.setAttribute('role', 'status');
  nearbyStatus.setAttribute('aria-live', 'polite');
  button.insertAdjacentElement('afterend', nearbyStatus);
  button.addEventListener('click', async () => {
    if (!selectedGateway || !canEditHardware) return;
    const readType = button.dataset.configRead;
    const gateway = selectedGateway;
    const feedback = readType === 'ble_report_interval' ? document.getElementById('gatewayIntervalFeedback')
      : readType === 'bxp_button_filter' ? document.getElementById('gatewayButtonFilterFeedback') : nearbyStatus;
    if (!await confirmAction({
      title: 'Consultar configuración observada',
      message: `Solicitar ${readType} a ${selectedGateway.mac_address}? La respuesta se registrará como observada, no como ACK correlacionado.`,
      confirmText: 'Consultar'
    }) || selectedGateway?.id !== gateway.id) return;
    try {
      if (['ble_report_fields', 'ble_parsing_options'].includes(readType)) { delete formatObservations[readType]; updateFormatAvailability(); }
      feedback.textContent = `Esperando respuesta para ${readType}…`;
      const result = await apiPost(`/gateways/${gateway.id}/read-configuration/${readType}`, {});
      if (selectedGateway?.id !== gateway.id) return;
      if (readType === 'bxp_button_filter' && selectedGateway?.id === gateway.id && result.status === 'response_observed') {
        const expected = ['abnormal_inactivity', 'double_press', 'long_press', 'single_press', 'switch_value'];
        const data = result.data;
        b5FilterObserved = data && Object.keys(data).sort().join(',') === expected.join(',') &&
          expected.every(key => data[key] === 0 || data[key] === 1) &&
          typeof result.readId === 'string' && /^[0-9a-f-]{36}$/i.test(result.readId)
          ? { readId: result.readId, data: { ...data }, gatewayId: gateway.id, receivedAt: Date.now() } : null;
        refreshFirmwareControls(gateway);
      }
      if (['ble_report_fields', 'ble_parsing_options'].includes(readType) && result.status === 'response_observed') {
        const fields = Object.keys(formatOptionLabels[readType]);
        const data = result.data;
        if (data && Object.keys(data).sort().join(',') === [...fields].sort().join(',') && fields.every(key => data[key] === 0 || data[key] === 1) && typeof result.readId === 'string' && /^[0-9a-f-]{36}$/i.test(result.readId)) {
          formatObservations[readType] = { readId: result.readId, data: { ...data }, gatewayId: gateway.id, receivedAt: Date.now() };
          renderFormatObservation(readType, data);
        } else delete formatObservations[readType];
        updateFormatAvailability();
        if (formatObservations[readType]) formatStatus.textContent = 'Casillas cargadas desde la respuesta observada. Marca las opciones que quieras activar y desmarca las que quieras desactivar.';
      }
      feedback.textContent = result.status === 'response_observed'
        ? `Respuesta observada: ${JSON.stringify(result.data)}. La fecha aparece en Configuración observada; no hay correlación inequívoca.`
        : result.message;
    } catch (error) {
      feedback.textContent = `Lectura ${readType} no confirmada: ${error.message}`;
    }
    await refreshTechnicalHistory();
  });
}

for (const button of formatButtons) button.addEventListener('click', async () => {
  const gateway = selectedGateway, readType = button.dataset.formatApply, observation = formatObservations[readType];
  if (formatSubmitting || !gateway || !observation || observation.gatewayId !== gateway.id || Date.now() - observation.receivedAt > 60000) { updateFormatAvailability(); return; }
  const values = Object.fromEntries([...formatGroups[readType].querySelectorAll('input[type="checkbox"]')].map(input => [input.name, input.checked ? 1 : 0]));
  formatSubmitting = true;
  updateFormatAvailability();
  try {
    const confirmed = await confirmAction({ title: 'Confirmar cambio de formato BLE',
      message: `Gateway ${gateway.mac_address}. Valores solicitados: ${JSON.stringify(values)}. La lectura no se correlaciona inequívocamente y un cambio externo puede dejarla obsoleta. Desactivar datos puede afectar detecciones y diagnóstico.`, confirmText: 'Solicitar cambio' });
    if (!confirmed || selectedGateway?.id !== gateway.id || formatObservations[readType] !== observation) return;
    delete formatObservations[readType];
    formatStatus.textContent = 'Solicitando cambio; espera el resultado…';
    const result = await apiPost(`/gateways/${gateway.id}/ble-report-format`, { readId: observation.readId, readType, values, uiContract: '20261126-2' });
    if (selectedGateway?.id === gateway.id) { formatStatus.textContent = result.message; await refreshTechnicalHistory(); }
  } catch (error) {
    if (selectedGateway?.id === gateway.id) formatStatus.textContent = `Resultado no confirmado: ${error.message}. Revisa el historial y consulta de nuevo antes de otro intento.`;
  } finally { formatSubmitting = false; updateFormatAvailability(false); }
});

firmwareClearButton.addEventListener('click', async () => {
  if (!selectedGateway || !canEditHardware) return;
  const confirmed = await confirmAction({
    title: 'Marcar firmware desconocido',
    message: `Se deshabilitarán los controles V2 de ${selectedGateway.mac_address}. ¿Continuar?`,
    confirmText: 'Marcar desconocido'
  });
  if (!confirmed) return;
  await apiDelete(`/gateways/${selectedGateway.id}/firmware`);
  await loadGateways();
});

const devicesState = createLoadState({ anchor: devicesBody.closest('table'),
  label: 'dispositivos con última observación central en esta gateway',
  clear: () => devicesBody.replaceChildren(), onRetry: () => selectedGateway && refreshGatewayDevices(selectedGateway.id) });
const refreshGatewayDevices = async (gatewayId) => {
  devicesState('loading');
  try {
    const devices = await apiGet('/devices');
    if (selectedGateway?.id !== gatewayId) return;
    const observed = devices.filter((device) => Number(device.last_gateway_id) === gatewayId);
    renderHistory(devicesBody, observed, [
      (item) => item.name || 'Sin nombre',
      (item) => item.ble_mac,
      (item) => item.device_type,
      (item) => item.last_seen_at ? new Date(item.last_seen_at).toLocaleString('es-ES') : '—'
    ]);
    devicesState('ready');
    if (!observed.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.textContent = 'Sin última observación central de dispositivos en esta gateway.';
      row.appendChild(cell);
      devicesBody.appendChild(row);
    }
  } catch (error) {
    if (selectedGateway?.id === gatewayId) devicesState(error.status === 403 ? 'denied' : 'error', error);
  }
};

document.getElementById('gatewayApplyRssi').addEventListener('click', async () => {
  const rssi = Number(gatewayRssi.value);
  if (gatewayRssi.value.trim() === '' || !Number.isInteger(rssi) || rssi < -127 || rssi > 0) {
    technicalFeedback.textContent = 'El RSSI debe ser un entero entre -127 y 0 dBm.';
    return;
  }
  const gateway = selectedGateway;
  if (!gateway || !await confirmAction({ title: 'Solicitar filtro físico BLE', message: `Solicitar filtro RSSI ${rssi} dBm a ${gateway.mac_address} mediante 1042? No cambia el umbral local de presencia de Horneo. El ACK no es una lectura física.`, confirmText: 'Solicitar' }) || selectedGateway?.id !== gateway.id) return;
  try {
    technicalFeedback.textContent = 'Esperando confirmación de la gateway…';
    const result = await apiPost(`/gateways/${gateway.id}/apply-rssi`, { rssi });
    technicalFeedback.textContent = result.status === 'success' ? `ACK satisfactorio para filtro solicitado ${rssi} dBm. No demuestra el filtro físico actual.` : `Sin ACK satisfactorio: ${result.resultMessage || result.status}`;
    if (result.status === 'success' && selectedGateway?.id === gateway.id) {
      selectedGateway.rssi_threshold = rssi;
      document.getElementById('gatewayRssiSaved').textContent = `Valor guardado central: ${rssi} dBm tras ACK. No verificado mediante lectura física.`;
    }
    await refreshTechnicalHistory();
  } catch (error) {
    technicalFeedback.textContent = `No se pudo aplicar RSSI: ${error.message}`;
  }
});

document.getElementById('gatewayConfigureB5').addEventListener('click', async () => {
  const gateway = selectedGateway;
  const observation = b5FilterObserved;
  if (!gateway || !observation || observation.gatewayId !== gateway.id || Date.now() - observation.receivedAt > 60000) {
    b5FilterObserved = null;
    if (gateway) refreshFirmwareControls(gateway);
    technicalFeedback.textContent = 'La lectura 2053 ha caducado o no está disponible. Consulta de nuevo.';
    return;
  }
  const data = observation.data;
  if (!await confirmAction({ title: 'Activar doble pulsación en el filtro',
    message: `Gateway ${gateway.mac_address}: solo se enviará 1053 con double_press=1 y los otros valores observados: switch_value=${data.switch_value}, single_press=${data.single_press}, long_press=${data.long_press}, abnormal_inactivity=${data.abnormal_inactivity}. ${data.switch_value === 0 ? 'El filtro seguirá desactivado. ' : ''}La lectura no tiene correlación inequívoca y otro cambio podría haberla dejado obsoleta. No demuestra recepción de SOS.`,
    confirmText: 'Solicitar cambio' }) || selectedGateway?.id !== gateway.id || b5FilterObserved !== observation) return;
  b5FilterObserved = null;
  refreshFirmwareControls(gateway);
  try {
    technicalFeedback.textContent = 'Solicitando el cambio 1053…';
    const result = await apiPost(`/gateways/${gateway.id}/b5-double-press-filter`, { readId: observation.readId });
    if (selectedGateway?.id !== gateway.id) return;
    technicalFeedback.textContent = result.message;
    await refreshTechnicalHistory();
  } catch (error) {
    if (selectedGateway?.id === gateway.id) technicalFeedback.textContent = `Resultado no confirmado: ${error.message}. Revisa el historial y consulta de nuevo antes de cualquier otro intento.`;
  }
});

document.getElementById('gatewayMqttRestorePreset').addEventListener('click', applyMqttPreset);

mqttForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedGateway || !canEditHardware || !mqttPresetReady || mqttSubmitting) return;
  const gateway = selectedGateway;
  const passwordInput = mqttForm.elements.namedItem('passwd');
  const mac = normalizedCentralMac(gateway);
  const data = mqttFormData();
  if (mqttForm.elements.namedItem('confirmationMac').value !== mac) {
    mqttFeedback.textContent = `Escribe exactamente ${mac} para confirmar.`;
    passwordInput.value = '';
    return;
  }
  if (!validateMqttForm(data, mac)) {
    mqttFeedback.textContent = 'La configuración MQTT no es válida. Revisa tipos, rangos, topics y payload LWT.';
    passwordInput.value = '';
    return;
  }
  const escapeConfirmation = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  mqttSubmitting = true;
  setMqttFormAvailability(true);
  passwordInput.value = '';
  try {
    const confirmed = await confirmAction({
      title: 'Confirmar configuración propuesta y reinicio',
      message: `Gateway ${escapeConfirmation(mac)}${gateway.name ? ` (${escapeConfirmation(gateway.name)})` : ''}: servidor ${escapeConfirmation(data.host)}, puerto ${escapeConfirmation(data.port)}, seguridad ${data.security_type === 1 ? 'TLS (1)' : 'SIN TLS (0)'}. Se enviará 1030 y solo tras ACK satisfactorio se solicitará 1000. Esto no demuestra conexión al destino.`,
      confirmText: 'Enviar configuración y reiniciar'
    });
    if (!confirmed || selectedGateway?.id !== gateway.id) return;
    mqttFeedback.textContent = 'Enviando una única orden 1030 y esperando su ACK…';
    const request = apiPost(`/gateways/${gateway.id}/configure-mqtt`, {
      confirmationMac: mac,
      data
    });
    passwordInput.value = '';
    const result = await request;
    mqttFeedback.textContent = result.message;
  } catch (error) {
    mqttFeedback.textContent = 'No se pudo completar la configuración MQTT. Revisa el historial de comandos antes de reintentar; no se confirma conexión al destino.';
  } finally {
    data.passwd = '';
    mqttSubmitting = false;
    if (selectedGateway?.id === gateway.id) { passwordInput.value = ''; setMqttFormAvailability(mqttPresetReady); }
    else await applyMqttPreset();
    await refreshTechnicalHistory();
  }
});

const bluetoothFields = {
  scan: 'scan_switch',
  'filter-relation': 'relation',
  duplicates: 'rule',
  phy: 'phy_filter',
  'report-interval': 'interval',
  'scan-mode': 'scan_mode'
};

for (const button of bluetoothPanel.querySelectorAll('[data-ble-command]')) {
  const nearbyStatus = document.createElement('span');
  nearbyStatus.setAttribute('role', 'status');
  nearbyStatus.setAttribute('aria-live', 'polite');
  button.insertAdjacentElement('afterend', nearbyStatus);
  button.addEventListener('click', async () => {
    const operation = button.dataset.bleCommand;
    const gateway = selectedGateway;
    const feedback = operation === 'report-interval' ? document.getElementById('gatewayIntervalFeedback') : nearbyStatus;
    const input = bluetoothPanel.querySelector(`[data-ble-input="${operation}"]`);
    const value = Number(input.value);
    if (!gateway || !Number.isInteger(value) || (operation === 'report-interval' && (value < 0 || value > 86400))) {
      feedback.textContent = 'Valor Bluetooth no válido.';
      return;
    }
    const confirmed = await confirmAction({
      title: 'Aplicar configuración Bluetooth',
      message: `Enviar ${operation}=${value} a ${gateway.mac_address}? Algunos cambios pueden afectar la presencia.`,
      confirmText: 'Aplicar'
    });
    if (!confirmed || selectedGateway?.id !== gateway.id) return;
    try {
      feedback.textContent = 'Esperando confirmación de la gateway…';
      const result = await apiPost(`/gateways/${gateway.id}/bluetooth/${operation}`, { [bluetoothFields[operation]]: value });
      if (selectedGateway?.id !== gateway.id) return;
      feedback.textContent = result.status === 'success'
        ? `${operation} confirmado por la gateway.`
        : `${operation} no confirmado: ${result.resultMessage || result.status}`;
      await refreshTechnicalHistory();
    } catch (error) {
      feedback.textContent = `No se pudo aplicar ${operation}: ${error.message}`;
    }
  });
}

setInterval(() => { void refreshTechnicalHistory(); }, 5000);

const renderGateways = () => {
  gatewaysTableBody.innerHTML = '';
  if (!gateways.length) {
    return;
  }

    gateways.forEach((gateway) => {
    const row = document.createElement('tr');
    for (const value of [gateway.name || 'Sin nombre', gateway.mac_address, gateway.company_name || 'Sin compañía', ownerLabel(gateway), gateway.active ? 'Activa' : 'Inactiva', '']) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    const actionsCell = row.lastElementChild;
    const container = document.createElement('div');
    container.className = 'actions';
    const technicalButton = document.createElement('button');
    technicalButton.type = 'button';
    technicalButton.textContent = 'Gestión técnica';
    technicalButton.addEventListener('click', () => selectGateway(gateway));
    container.appendChild(technicalButton);

    if (canEditHardware) {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.textContent = 'Editar';
      editButton.disabled = isAdmin && !metadata.ready('usuarios');
      editButton.title = editButton.disabled ? 'Faltan los propietarios necesarios para editar.' : '';
      editButton.addEventListener('click', () => handleEditGateway(gateway));
      container.appendChild(editButton);
    }

    if (isAdmin) {
      if (gateway.active && !gateway.company_id) {
        const assignButton = document.createElement('button');
        assignButton.type = 'button';
        assignButton.textContent = 'Asignar compañía';
        assignButton.disabled = !metadata.ready('compañías');
        assignButton.title = assignButton.disabled ? 'Faltan las compañías disponibles para asignar.' : '';
        assignButton.addEventListener('click', () => handleAssignCompany(gateway));
        container.appendChild(assignButton);
      }
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.textContent = 'Desactivar';
      deleteButton.className = 'secondary';
      deleteButton.addEventListener('click', () => handleDeleteGateway(gateway));
      container.appendChild(deleteButton);
    }

    actionsCell.appendChild(container);
    gatewaysTableBody.appendChild(row);
  });
};

if (isAdmin && gatewayForm) {
  gatewayForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    gatewayMessage.style.display = 'none';
    const macInput = gatewayForm.gatewayMac.value.trim();
    const onboardingMacPattern = /^(?:[0-9a-f]{12}|(?:[0-9a-f]{2}:){5}[0-9a-f]{2}|(?:[0-9a-f]{2}-){5}[0-9a-f]{2})$/i;
    if (!onboardingMacPattern.test(macInput)) {
      gatewayMessage.textContent = 'La MAC indicada no tiene un formato válido.';
      gatewayMessage.className = 'alert error';
      gatewayMessage.style.display = 'block';
      return;
    }
    const macAddress = normalizeMac(macInput);

    if (!validateMac(macAddress)) {
      gatewayMessage.textContent = 'La MAC indicada no tiene un formato válido (12 caracteres hexadecimales).';
      gatewayMessage.className = 'alert error';
      gatewayMessage.style.display = 'block';
      return;
    }

    try {
      const result = await apiPost('/gateways/onboard', { macAddress });
      gatewayMessage.textContent = result.message;
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

void metadata.run();
void loadGateways();
