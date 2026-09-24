import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction } from './ui.js';

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
const gatewayCompanySelect = document.getElementById('gatewayCompany');
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

const mqttIntegerFields = [
  'security_type', 'port', 'qos', 'clean_session', 'keepalive', 'lwt_en', 'lwt_qos', 'lwt_retain'
];

const normalizedCentralMac = (gateway) => String(gateway?.mac_address || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();

const horizonstMqttPreset = (gateway) => {
  const mac = normalizedCentralMac(gateway);
  return {
    security_type: 1, host: 'mqtt.horizonst.com.es', port: 8883, client_id: mac, username: mac, passwd: '',
    sub_topic: `gw/${mac}/subscribe`, pub_topic: `gw/${mac}/publish`, qos: 0, clean_session: 1,
    keepalive: 60, lwt_en: 1, lwt_qos: 1, lwt_retain: 0, lwt_topic: `gw/${mac}/publish`,
    lwt_payload: JSON.stringify({ msg_id: 3999, device_info: { mac }, data: {} })
  };
};

const applyMqttPreset = () => {
  if (!selectedGateway) return;
  const preset = horizonstMqttPreset(selectedGateway);
  for (const [name, value] of Object.entries(preset)) mqttForm.elements.namedItem(name).value = String(value);
  mqttForm.elements.namedItem('confirmationMac').value = '';
};

const mqttFormData = () => Object.fromEntries([
  'security_type', 'host', 'port', 'client_id', 'username', 'passwd', 'sub_topic', 'pub_topic', 'qos',
  'clean_session', 'keepalive', 'lwt_en', 'lwt_qos', 'lwt_retain', 'lwt_topic', 'lwt_payload'
].map((name) => {
  const value = mqttForm.elements.namedItem(name).value;
  return [name, mqttIntegerFields.includes(name) ? Number(value) : value];
}));

const validateMqttForm = (data, mac) => {
  const byteLength = (value) => new TextEncoder().encode(value).length;
  if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65535
      || !Number.isInteger(data.keepalive) || data.keepalive < 0 || data.keepalive > 65535) return false;
  if (![data.security_type, data.qos, data.clean_session, data.lwt_en, data.lwt_qos, data.lwt_retain]
    .every((value) => Number.isInteger(value))) return false;
  if (![0, 1].includes(data.security_type) || ![0, 1].includes(data.qos) || ![0, 1].includes(data.lwt_qos)
      || ![data.clean_session, data.lwt_en, data.lwt_retain].every((value) => value === 0 || value === 1)) return false;
  if (!data.passwd || byteLength(data.passwd) > 256
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
  if (!value) return '';
  return value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
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
  document.getElementById('gatewayConfigureB5').disabled = !v2;
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
  if (!isAdmin) return;
  [owners, companies] = await Promise.all([apiGet('/users'), apiGet('/companies')]);
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

const loadGateways = async () => {
  gateways = await apiGet('/gateways');
  renderGateways();
  if (selectedGateway) {
    const updated = gateways.find((gateway) => gateway.id === selectedGateway.id);
    if (updated) await selectGateway(updated);
    else {
      selectedGateway = null;
      technicalPanel.hidden = true;
    }
  }
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
  if (gatewayCompanySelect) {
    gatewayCompanySelect.innerHTML = '<option value="">Sin empresa (legacy)</option>';
    companies.forEach((company) => {
      const option = document.createElement('option');
      option.value = company.id;
      option.textContent = company.name;
      gatewayCompanySelect.appendChild(option);
    });
  }

  if (isAdmin) {
    fields.push({ name: 'ownerId', label: 'Propietario', type: 'select', options: buildOwnerOptions() });
    fields.push({ name: 'companyId', label: 'Empresa', type: 'select', options: [
      { value: '', label: 'Sin empresa (legacy)' },
      ...companies.map((company) => ({ value: company.id, label: company.name }))
    ] });
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
      companyId: gateway.company_id ?? ''
    },
    onSubmit: async (values) => {
      const payload = {
        name: values.name ? String(values.name).trim() : '',
        description: values.description ? String(values.description).trim() : '',
        ...(isAdmin ? { active: values.active === 'true' } : {})
      };
      if (isAdmin) {
        payload.ownerId = values.ownerId ? Number(values.ownerId) : null;
        payload.companyId = values.companyId || null;
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

const refreshTechnicalHistory = async () => {
  if (!selectedGateway || document.hidden) return;
  const gatewayId = selectedGateway.id;
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
      (item) => item.result_code == null ? item.result_message : `${item.result_code}: ${item.result_message || ''}`
    ];
    renderHistory(commandsBody, commands, commandColumns);
    renderHistory(mqttHistoryBody, commands.filter((item) => item.msg_id === 1030), [
      commandColumns[0], commandColumns[3], commandColumns[4], commandColumns[5], commandColumns[6]
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
  } catch (error) {
    technicalFeedback.textContent = `No se pudo actualizar el historial: ${error.message}`;
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
  technicalPanel.hidden = false;
  technicalTitle.textContent = gateway.name || gateway.mac_address;
  technicalSummary.textContent = `MAC ${gateway.mac_address} · ${gateway.company_name || 'Sin empresa'} · ${gateway.place_name || 'Sin ubicación'} · ${gateway.active ? 'Activa' : 'Inactiva'} · registro manual: ${gateway.product_model || 'modelo desconocido'} ${gateway.firmware_version || 'firmware desconocido'}${gateway.firmware_evidence ? ` · evidencia ${gateway.firmware_evidence}` : ''}`;
  technicalActions.hidden = !canEditHardware || !gateway.active || !gateway.company_id;
  bluetoothPanel.hidden = technicalActions.hidden;
  mqttPanel.hidden = technicalActions.hidden;
  mqttConfirmationMac.textContent = normalizedCentralMac(gateway);
  applyMqttPreset();
  refreshFirmwareControls(gateway);
  renderReportedIdentity(gateway);
  gatewayRssi.value = gateway.rssi_threshold ?? -127;
  technicalFeedback.textContent = '';
  await Promise.all([refreshTechnicalHistory(), refreshGatewayDevices(gateway.id)]);
};

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
  button.addEventListener('click', async () => {
    if (!selectedGateway || !canEditHardware) return;
    const readType = button.dataset.configRead;
    if (!await confirmAction({
      title: 'Consultar configuración observada',
      message: `Solicitar ${readType} a ${selectedGateway.mac_address}? La respuesta se registrará como observada, no como ACK correlacionado.`,
      confirmText: 'Consultar'
    })) return;
    try {
      technicalFeedback.textContent = `Esperando respuesta para ${readType}…`;
      const result = await apiPost(`/gateways/${selectedGateway.id}/read-configuration/${readType}`, {});
      technicalFeedback.textContent = result.message;
    } catch (error) {
      technicalFeedback.textContent = `Lectura ${readType} no confirmada: ${error.message}`;
    }
    await refreshTechnicalHistory();
  });
}

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

const refreshGatewayDevices = async (gatewayId) => {
  try {
    const devices = await apiGet('/devices');
    if (selectedGateway?.id !== gatewayId) return;
    renderHistory(devicesBody, devices.filter((device) => Number(device.last_gateway_id) === gatewayId), [
      (item) => item.name || 'Sin nombre',
      (item) => item.ble_mac,
      (item) => item.device_type,
      (item) => item.last_seen_at ? new Date(item.last_seen_at).toLocaleString('es-ES') : '—'
    ]);
  } catch (error) {
    technicalFeedback.textContent = `No se pudo cargar el inventario de tags: ${error.message}`;
  }
};

document.getElementById('gatewayApplyRssi').addEventListener('click', async () => {
  const rssi = Number(gatewayRssi.value);
  if (!Number.isInteger(rssi) || rssi < -127 || rssi > 0) {
    technicalFeedback.textContent = 'El RSSI debe ser un entero entre -127 y 0 dBm.';
    return;
  }
  if (!selectedGateway || !await confirmAction({ title: 'Aplicar filtro BLE', message: `Aplicar RSSI ${rssi} dBm a ${selectedGateway.mac_address}?`, confirmText: 'Aplicar' })) return;
  try {
    technicalFeedback.textContent = 'Esperando confirmación de la gateway…';
    const result = await apiPost(`/gateways/${selectedGateway.id}/apply-rssi`, { rssi });
    technicalFeedback.textContent = result.status === 'success' ? 'RSSI aplicado y confirmado.' : `No confirmado: ${result.resultMessage || result.status}`;
    await refreshTechnicalHistory();
  } catch (error) {
    technicalFeedback.textContent = `No se pudo aplicar RSSI: ${error.message}`;
  }
});

document.getElementById('gatewayConfigureB5').addEventListener('click', async () => {
  if (!selectedGateway || !await confirmAction({ title: 'Configurar doble pulsación B5', message: `Se enviarán cuatro comandos BLE a ${selectedGateway.mac_address}. ¿Continuar?`, confirmText: 'Configurar' })) return;
  try {
    technicalFeedback.textContent = 'Esperando confirmación de los cuatro comandos…';
    const result = await apiPost(`/gateways/${selectedGateway.id}/configure-emergency-button`, {});
    technicalFeedback.textContent = result.ok
      ? 'B5 configurado correctamente: cuatro comandos confirmados.'
      : `Configuración incompleta: ${(result.results || []).map((item) => `${item.msgId}: ${item.status}${item.resultCode == null ? '' : ` (${item.resultCode})`}`).join(' · ')}`;
    await refreshTechnicalHistory();
  } catch (error) {
    technicalFeedback.textContent = `No se pudo configurar B5: ${error.message}`;
  }
});

document.getElementById('gatewayMqttRestorePreset').addEventListener('click', applyMqttPreset);

mqttForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedGateway || !canEditHardware) return;
  const passwordInput = mqttForm.elements.namedItem('passwd');
  const mac = normalizedCentralMac(selectedGateway);
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
  try {
    mqttFeedback.textContent = 'Enviando una única orden 1030 y esperando su ACK…';
    const request = apiPost(`/gateways/${selectedGateway.id}/configure-mqtt`, {
      confirmationMac: mac,
      data
    });
    passwordInput.value = '';
    const result = await request;
    mqttFeedback.textContent = result.message;
  } catch (error) {
    mqttFeedback.textContent = error.message;
  } finally {
    passwordInput.value = '';
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
  button.addEventListener('click', async () => {
    const operation = button.dataset.bleCommand;
    const input = bluetoothPanel.querySelector(`[data-ble-input="${operation}"]`);
    const value = Number(input.value);
    if (!selectedGateway || !Number.isInteger(value) || (operation === 'report-interval' && (value < 0 || value > 86400))) {
      technicalFeedback.textContent = 'Valor Bluetooth no válido.';
      return;
    }
    const confirmed = await confirmAction({
      title: 'Aplicar configuración Bluetooth',
      message: `Enviar ${operation}=${value} a ${selectedGateway.mac_address}? Algunos cambios pueden afectar la presencia.`,
      confirmText: 'Aplicar'
    });
    if (!confirmed) return;
    try {
      technicalFeedback.textContent = 'Esperando confirmación de la gateway…';
      const result = await apiPost(`/gateways/${selectedGateway.id}/bluetooth/${operation}`, { [bluetoothFields[operation]]: value });
      technicalFeedback.textContent = result.status === 'success'
        ? `${operation} confirmado por la gateway.`
        : `${operation} no confirmado: ${result.resultMessage || result.status}`;
      await refreshTechnicalHistory();
    } catch (error) {
      technicalFeedback.textContent = `No se pudo aplicar ${operation}: ${error.message}`;
    }
  });
}

setInterval(() => { void refreshTechnicalHistory(); }, 5000);

const renderGateways = () => {
  gatewaysTableBody.innerHTML = '';
  if (!gateways.length) {
    gatewaysEmpty.style.display = 'block';
    return;
  }
  gatewaysEmpty.style.display = 'none';

    gateways.forEach((gateway) => {
    const row = document.createElement('tr');
    for (const value of [gateway.name || 'Sin nombre', gateway.mac_address, gateway.company_name || 'Sin empresa (legacy)', ownerLabel(gateway), gateway.active ? 'Activa' : 'Inactiva', '']) {
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
      editButton.addEventListener('click', () => handleEditGateway(gateway));
      container.appendChild(editButton);
    }

    if (isAdmin) {
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
      ownerId: gatewayOwnerSelect && gatewayOwnerSelect.value ? Number(gatewayOwnerSelect.value) : null,
      companyId: gatewayCompanySelect && gatewayCompanySelect.value ? gatewayCompanySelect.value : null
    };

    try {
      await apiPost('/gateways', payload);
      gatewayMessage.textContent = 'Gateway registrada correctamente.';
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
    await loadOwners();
    await loadGateways();
  } catch (error) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = error.message;
    row.appendChild(cell);
    gatewaysTableBody.replaceChildren(row);
  }
};

init();
