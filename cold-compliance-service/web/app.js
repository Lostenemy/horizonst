let token = localStorage.getItem('cc_token') || '';
let currentUser = null;
let realtimeSource = null;
let lastSnapshot = null;
let alertsCache = [];
const alertsUI = { page: 1, pageSize: 20, selected: new Set() };
const sectionMeta = {
  dashboard: { title: 'Dashboard operativo', breadcrumb: 'Inicio / Dashboard' },
  users: { title: 'Gestión de usuarios', breadcrumb: 'Inicio / Usuarios' },
  inventory: { title: 'Gateways y tags', breadcrumb: 'Inicio / Inventario' },
  assignments: { title: 'Asignaciones', breadcrumb: 'Inicio / Asignaciones' },
  alertsCenter: { title: 'Alertas disparadas', breadcrumb: 'Inicio / Alertas' },
  alarms: { title: 'Reglas de alarma', breadcrumb: 'Inicio / Reglas' },
  reports: { title: 'Informes', breadcrumb: 'Inicio / Informes' }
};
const tabs = [
  { id: 'dashboard', label: 'Inicio' },
  { id: 'users', label: 'Usuarios' },
  { id: 'inventory', label: 'Gateways y tags' },
  { id: 'assignments', label: 'Asignaciones' },
  { id: 'alertsCenter', label: 'Alertas disparadas' },
  { id: 'alarms', label: 'Reglas de alarma' },
  { id: 'reports', label: 'Informes' }
];

const q = (id) => document.getElementById(id);
const sections = tabs.map((t) => t.id);

const inlineEdit = {
  users: { id: null, draft: null },
  tags: { id: null, draft: null },
  gateways: { id: null, draft: null },
  workers: { id: null, draft: null },
  alarmRules: { id: null, draft: null }
};

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function apiErrorMessage(error) {
  const raw = String(error && error.message ? error.message : error || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.message) return parsed.message;
  } catch {}
  return raw || 'Error inesperado';
}

function toast(message, type = 'success') {
  const stack = q('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function roleLabel(role) {
  return ({ supervisor: 'Supervisor', administrador: 'Administrador', superadministrador: 'Superadministrador', trabajador: 'Trabajador' }[role] || role || '-');
}
function statusLabel(status) { return ({ active: 'Activo', inactive: 'Inactivo' }[status] || status || '-'); }
function alertTypeLabel(type) {
  return ({
    alarm_rule_alarm: 'Alarma por permanencia',
    continuous_limit_exceeded: 'Límite continuo superado',
    alarm_rule_warning: 'Aviso de permanencia'
  }[type] || String(type || '').replaceAll('_', ' '));
}
function severityLabel(severity) { return ({ critical: 'Crítica', warning: 'Advertencia', info: 'Información' }[severity] || severity || '-'); }

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  if (res.status === 401 && token) {
    localStorage.removeItem('cc_token');
    token = '';
    if (realtimeSource) realtimeSource.close();
    q('loginView').hidden = false;
    q('loginView').style.display = 'flex';
    q('appView').hidden = true;
    q('appView').style.display = 'none';
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

function roleCan(required) {
  const rank = { supervisor: 1, administrador: 2, superadministrador: 3 };
  return currentUser && rank[currentUser.role] >= rank[required];
}

function setSectionHeader(section) {
  q('sectionTitle').textContent = sectionMeta[section].title;
  q('sectionBreadcrumb').textContent = sectionMeta[section].breadcrumb;
  document.querySelectorAll('#mainTabs button').forEach((btn) => btn.classList.toggle('active', btn.dataset.section === section));
}

function showSection(section) {
  sections.forEach((s) => (q(s).hidden = s !== section));
  setSectionHeader(section);
  if (window.innerWidth <= 768) q('mainTabs').classList.remove('open');
  if (section === 'dashboard') renderDashboard();
  if (section === 'users') renderUsers();
  if (section === 'inventory') renderInventory();
  if (section === 'assignments') renderAssignments();
  if (section === 'alertsCenter') renderAlertsCenter();
  if (section === 'alarms') renderAlarms();
  if (section === 'reports') renderReports();
}

function renderNav() {
  q('mainTabs').innerHTML = tabs.map((tab) => `<button data-section="${tab.id}" onclick="showSection('${tab.id}')">${tab.label}</button>`).join('');
  if (window.innerWidth <= 768) q('mainTabs').classList.remove('open');
}

function setSessionText(extra = '') {
  q('sessionBox').innerHTML = currentUser
    ? `<div class="header-right"><div class="header-user-info"><b>${currentUser.email}</b><br><small>${roleLabel(currentUser.role)} ${extra}</small></div><button class="btn-logout" onclick="logout()">Salir</button></div>`
    : '';
}

function setGlobalStatus(message) {
  q('globalStatus').innerHTML = `<span class="live-timestamp">${message}</span>`;
}

function stateBadge(state) {
  if (state === 'alarma') return '<span class="badge alert">Alarma</span>';
  if (state === 'dentro') return '<span class="badge warn">Dentro</span>';
  if (state === 'gracia') return '<span class="badge info">En gracia</span>';
  return '<span class="badge ok">Fuera</span>';
}

function severityBadge(severity) {
  if (severity === 'critical') return '<span class="badge alert">Crítica</span>';
  if (severity === 'warning') return '<span class="badge warn">Advertencia</span>';
  return '<span class="badge info">Info</span>';
}

function table(headers, rows, tableClass = "") {
  const body = rows.length ? rows.map((r) => `<tr>${r.map((c, idx) => `<td data-label="${headers[idx] || ''}">${c == null ? '' : c}</td>`).join('')}</tr>`).join('') : '<tr class="empty-state"><td colspan="99">Sin datos</td></tr>';
  return `<div class="table-wrap ${tableClass}"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function startInlineEdit(scope, id, draft) { inlineEdit[scope] = { id, draft: { ...draft } }; }
function cancelInlineEdit(scope) { inlineEdit[scope] = { id: null, draft: null }; }
function updateInlineEdit(scope, field, value) { if (inlineEdit[scope].draft) inlineEdit[scope].draft[field] = value; }

async function login() {
  const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: q('username').value, password: q('password').value }) });
  token = data.token;
  currentUser = data.user;
  localStorage.setItem('cc_token', token);
  q('loginView').hidden = true;
  q('loginView').style.display = 'none';
  q('appView').hidden = false;
  q('appView').style.display = 'block';
  setSessionText();
  startRealtime();
  showSection('dashboard');
  toast('Sesión iniciada correctamente');
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  token = '';
  currentUser = null;
  localStorage.removeItem('cc_token');
  if (realtimeSource) realtimeSource.close();
  q('loginView').hidden = false;
  q('loginView').style.display = 'flex';
  q('appView').hidden = true;
  q('appView').style.display = 'none';
}

async function forgotPassword() {
  await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: q('fpEmail').value }) });
  toast('Si el email existe, se envió un correo de recuperación.');
}

async function resetPassword() {
  await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: q('rpToken').value, newPassword: q('rpPass').value }) });
  toast('Contraseña actualizada.');
}

async function renderDashboard(snapshot) {
  const data = snapshot || (await api('/realtime/snapshot'));
  lastSnapshot = data;
  const activeAlerts = data.activeAlerts || [];
  const hasCritical = activeAlerts.some((a) => a.severity === 'critical');
  const hasWarning = activeAlerts.some((a) => a.severity === 'warning');
  const alertKpiClass = hasCritical ? 'alert' : hasWarning ? 'warn' : 'success';
  const alertsRows = activeAlerts.slice(0, 5).map((a) => [
    `<a href="#" onclick="openAlertsFiltered('${a.severity}');return false;">${alertTypeLabel(a.alert_type)}</a>`,
    severityBadge(a.severity),
    a.message,
    formatDateTime(a.created_at)
  ]);
  const workersRows = (data.workersInside || []).map((w) => [w.full_name, w.dni, w.tag_uid, Math.floor(w.elapsed_seconds / 60), stateBadge(w.presence_status)]);
  const graceRows = (data.workersGrace || []).map((w) => [w.full_name, w.tag_uid || '-', `${Math.floor((w.since_last_detection_seconds || 0) / 60)}m ${(w.since_last_detection_seconds || 0) % 60}s`, stateBadge('gracia')]);
  const systemState = data.systemOnline === false
    ? '<span class="badge alert">Sistema offline</span>'
    : data.totals.workersInside === 0
      ? '<span class="badge ok">Nadie dentro</span>'
      : '<span class="badge warn">Sistema activo</span>';

  q('dashboard').innerHTML = `
    <div class="actions mb-12">
      <button onclick="refreshDashboardNow()">↻ Actualizar ahora</button>
      <span class="kpi-note">Auto-actualización activa cada evento en tiempo real + refresco manual.</span>
    </div>
    <div class="metrics kpi-grid dashboard-kpi-row">
      <div class="metric kpi-card ${data.totals.workersInside ? 'warn' : 'success'}"><small class="kpi-label">Trabajadores dentro</small><b class="kpi-value">${data.totals.workersInside}</b></div>
      <div class="metric kpi-card ${(data.totals.workersGrace || 0) ? 'info' : 'success'}"><small class="kpi-label">En estado de gracia</small><b class="kpi-value">${data.totals.workersGrace || 0}</b></div>
      <div class="metric kpi-card ${alertKpiClass} clickable" onclick="openAlertsFiltered('')"><small class="kpi-label">Alarmas disparadas</small><b class="kpi-value">${data.totals.activeAlerts}</b></div>
      <div class="metric kpi-card ${data.systemOnline === false ? 'alert' : 'success'}"><small class="kpi-label">Estado del sistema</small><b style="font-size:16px">${systemState}</b></div>
      <div class="metric kpi-card info kpi-timestamp"><small class="kpi-label">Última actualización</small><b class="kpi-date kpi-value">${formatDateTime(data.ts)}</b></div>
    </div>
    <div class="presence-columns grid two">
      <div class="presence-column">
        <h3>Trabajadores dentro</h3>
        ${workersRows.length ? table(['Trabajador', 'DNI', 'Tag', 'Min dentro', 'Estado'], workersRows) : '<div class="list-empty">No hay trabajadores dentro en este momento.</div>'}
      </div>
      <div class="presence-column">
        <h3>En estado de gracia</h3>
        ${graceRows.length ? table(['Trabajador', 'Tag', 'Desde última detección', 'Estado'], graceRows) : '<div class="list-empty">Sin trabajadores en gracia.</div>'}
      </div>
    </div>
    <h3 class="mt-12">Alarmas activas (últimas 5)</h3>
    ${alertsRows.length ? table(['Tipo', 'Severidad', 'Mensaje', 'Fecha'], alertsRows, 'alarm-table') : '<div class="list-empty">Sin alarmas activas.</div>'}
    <div class="actions mt-12"><button class="secondary" onclick="openAlertsFiltered('')">Ver todas</button></div>
  `;
  setGlobalStatus(`Último evento en vivo: ${formatDateTime(data.ts)}`);
}

async function refreshDashboardNow() {
  await renderDashboard();
  toast('Dashboard actualizado');
}

function openAlertsFiltered(severity) {
  showSection('alertsCenter');
  setTimeout(() => {
    if (q('acState')) q('acState').value = 'active';
    if (q('acSeverity')) q('acSeverity').value = severity;
    renderAlertsCenter();
  }, 0);
}

function validateUserFormLive() {
  const emailEl = q('uEmail');
  const passEl = q('uPass');
  const dniEl = q('uDni');
  if (!emailEl || !passEl || !dniEl) return;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value);
  const passOk = passEl.value.length >= 8;
  const dniOk = /^[0-9XYZxyz][0-9]{7}[A-Za-z]$/.test(dniEl.value.trim()) || /^[A-Za-z0-9]{6,12}$/.test(dniEl.value.trim());
  emailEl.className = emailEl.value ? (emailOk ? 'valid' : 'invalid') : '';
  passEl.className = passEl.value ? (passOk ? 'valid' : 'invalid') : '';
  dniEl.className = dniEl.value ? (dniOk ? 'valid' : 'invalid') : '';
}

function filterUsersRows(users) {
  const term = (q('ufName')?.value || '').toLowerCase();
  const dni = (q('ufDni')?.value || '').toLowerCase();
  const role = q('ufRole')?.value || '';
  const status = q('ufStatus')?.value || '';
  return users.filter((u) => {
    const full = `${u.first_name} ${u.last_name}`.toLowerCase();
    return (!term || full.includes(term)) && (!dni || String(u.dni || '').toLowerCase().includes(dni)) && (!role || u.role === role) && (!status || u.status === status);
  });
}

async function renderUsers() {
  if (!roleCan('administrador')) {
    q('users').innerHTML = '<p>Sin permisos para gestionar usuarios.</p>';
    return;
  }
  const filters = {
    name: q('ufName')?.value || '',
    dni: q('ufDni')?.value || '',
    role: q('ufRole')?.value || '',
    status: q('ufStatus')?.value || ''
  };
  const users = await api('/users');
  const filtered = users.filter((u) => {
    const full = `${u.first_name} ${u.last_name}`.toLowerCase();
    return (!filters.name || full.includes(filters.name.toLowerCase())) && (!filters.dni || String(u.dni || '').toLowerCase().includes(filters.dni.toLowerCase())) && (!filters.role || u.role === filters.role) && (!filters.status || u.status === filters.status);
  });
  q('users').innerHTML = `
    <div class="actions"><span class="badge users-total-badge">Total usuarios: ${filtered.length} / ${users.length}</span></div>
    <div class="grid four mt-12">
      <div class="field"><label>Buscar por nombre</label><input id="ufName" placeholder="Ej: Juan" value="${esc(filters.name)}" oninput="renderUsers()" /></div>
      <div class="field"><label>Filtrar por DNI</label><input id="ufDni" placeholder="12345678A" value="${esc(filters.dni)}" oninput="renderUsers()" /></div>
      <div class="field"><label>Filtrar por rol</label><select id="ufRole" onchange="renderUsers()"><option value="">Todos</option><option value="supervisor" ${filters.role === 'supervisor' ? 'selected' : ''}>Supervisor</option><option value="administrador" ${filters.role === 'administrador' ? 'selected' : ''}>Administrador</option><option value="superadministrador" ${filters.role === 'superadministrador' ? 'selected' : ''}>Superadministrador</option></select></div>
      <div class="field"><label>Filtrar por estado</label><select id="ufStatus" onchange="renderUsers()"><option value="">Todos</option><option value="active" ${filters.status === 'active' ? 'selected' : ''}>Activo</option><option value="inactive" ${filters.status === 'inactive' ? 'selected' : ''}>Inactivo</option></select></div>
    </div>

    <details class="mt-12" ${inlineEdit.users.id ? '' : 'open'}>
      <summary><b>Nuevo usuario</b></summary>
      <div class="grid three mt-12">
        <div class="field"><label>Nombre</label><input id="uNombre" placeholder="Nombre" /></div>
        <div class="field"><label>Apellidos</label><input id="uApellidos" placeholder="Apellidos" /></div>
        <div class="field"><label>Email</label><input id="uEmail" placeholder="Email" oninput="validateUserFormLive()" /></div>
        <div class="field"><label>Teléfono</label><input id="uTelefono" placeholder="Teléfono" /></div>
        <div class="field"><label>DNI</label><input id="uDni" placeholder="DNI" oninput="validateUserFormLive()" /></div>
        <div class="field"><label>Rol</label><select id="uRol"><option value="supervisor">Supervisor</option><option value="administrador">Administrador</option></select></div>
        <div class="field"><label>Estado</label><select id="uEstado"><option value="active">Activo</option><option value="inactive">Inactivo</option></select></div>
        <div class="field"><label>Contraseña</label><div class="inline"><input id="uPass" type="password" placeholder="Mínimo 8 caracteres" oninput="validateUserFormLive()" /><button type="button" class="secondary password-toggle-btn btn-mostrar" onclick="togglePassword('uPass', this)">Mostrar</button></div></div>
        <div class="field"><label>Turno</label><select id="uTurno"><option value="mañana">Mañana</option><option value="tarde">Tarde</option><option value="noche">Noche</option></select></div>
      </div>
      <button class="mt-12" onclick="createUser()">Crear usuario</button>
    </details>

    ${table(['Nombre', 'Email', 'Rol', 'Estado', 'Teléfono', 'DNI', 'Turno', 'Acciones'], filtered.map((u) => {
      const isEditing = inlineEdit.users.id === u.id;
      if (!isEditing) {
        return [
          `${u.first_name} ${u.last_name}`,
          u.email,
          roleLabel(u.role),
          statusLabel(u.status),
          u.phone || '-',
          u.dni,
          u.shift || '-',
          `<div class="table-actions user-table-actions"><button onclick="beginUserInlineEdit('${u.id}')">Editar</button><button onclick="deactivateUser('${u.id}')">Desactivar</button>${roleCan('superadministrador') ? `<button class='danger' onclick="deleteUser('${u.id}')">Borrar</button>` : ''}</div>`
        ];
      }
      const d = inlineEdit.users.draft;
      return [
        `<input value="${esc(d.nombre)}" oninput="updateInlineEdit('users','nombre',this.value)"/> <input class="mt-12" value="${esc(d.apellidos)}" oninput="updateInlineEdit('users','apellidos',this.value)"/>`,
        `<input value="${esc(d.email)}" oninput="updateInlineEdit('users','email',this.value)"/>`,
        `<select onchange="updateInlineEdit('users','rol',this.value)"><option value="supervisor" ${d.rol === 'supervisor' ? 'selected' : ''}>Supervisor</option><option value="administrador" ${d.rol === 'administrador' ? 'selected' : ''}>Administrador</option></select>`,
        `<select onchange="updateInlineEdit('users','estado',this.value)"><option value="active" ${d.estado === 'active' ? 'selected' : ''}>Activo</option><option value="inactive" ${d.estado === 'inactive' ? 'selected' : ''}>Inactivo</option></select>`,
        `<input value="${esc(d.telefono)}" oninput="updateInlineEdit('users','telefono',this.value)"/>`,
        `<input value="${esc(d.dni)}" oninput="updateInlineEdit('users','dni',this.value)"/>`,
        `<select onchange="updateInlineEdit('users','turno',this.value)"><option value="mañana" ${d.turno === 'mañana' ? 'selected' : ''}>Mañana</option><option value="tarde" ${d.turno === 'tarde' ? 'selected' : ''}>Tarde</option><option value="noche" ${d.turno === 'noche' ? 'selected' : ''}>Noche</option></select>`,
        `<input type="password" placeholder="Nueva contraseña (opcional)" oninput="updateInlineEdit('users','password',this.value)"/> <div class='mt-12'><button onclick="saveUserInlineEdit('${u.id}')">Guardar</button> <button class="secondary" onclick="cancelUserInlineEdit()">Cancelar</button></div>`
      ];
    }))}
  `;
}

function togglePassword(id, btn) {
  const input = q(id);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? 'Mostrar' : 'Ocultar';
}

async function createUser() {
  await api('/users', {
    method: 'POST',
    body: JSON.stringify({
      nombre: q('uNombre').value,
      apellidos: q('uApellidos').value,
      email: q('uEmail').value,
      telefono: q('uTelefono').value,
      dni: q('uDni').value,
      rol: q('uRol').value,
      estado: q('uEstado').value,
      password: q('uPass').value,
      turno: q('uTurno').value
    })
  });
  toast('Usuario creado correctamente');
  renderUsers();
}

async function beginUserInlineEdit(id) {
  const users = await api('/users');
  const user = users.find((u) => u.id === id);
  if (!user) return;
  startInlineEdit('users', id, {
    nombre: user.first_name,
    apellidos: user.last_name,
    email: user.email,
    telefono: user.phone || '',
    dni: user.dni,
    rol: user.role === 'superadministrador' ? 'administrador' : user.role,
    estado: user.status,
    turno: user.shift || 'mañana',
    password: ''
  });
  renderUsers();
}
function cancelUserInlineEdit() { cancelInlineEdit('users'); renderUsers(); }
async function saveUserInlineEdit(id) {
  const d = inlineEdit.users.draft;
  await api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ nombre: d.nombre, apellidos: d.apellidos, email: d.email, telefono: d.telefono || null, dni: d.dni, rol: d.rol, estado: d.estado, turno: d.turno || null, password: d.password || null }) });
  cancelInlineEdit('users');
  toast('Usuario actualizado');
  renderUsers();
}
async function deactivateUser(id) { await api(`/users/${id}/deactivate`, { method: 'POST' }); toast('Usuario desactivado'); renderUsers(); }
async function deleteUser(id) { if (!confirm('¿Seguro que deseas borrar este usuario?')) return; await api(`/users/${id}`, { method: 'DELETE' }); toast('Usuario borrado'); renderUsers(); }

async function renderInventory() {
  const [tags, gateways] = await Promise.all([api('/tags'), api('/gateways')]);
  q('inventory').innerHTML = `
    <div class="grid two">
      <div class="card-block">
        <h3>Tags</h3>
        ${roleCan('superadministrador') ? `
          <div class="field"><label>MAC del tag</label><input id="tagMac" placeholder="AA:BB:CC:DD:EE:FF" /></div>
          <div class="field mt-12"><label>Descripción del tag</label><input id="tagDesc" placeholder="Ej: B5 Terreros" /></div>
          <div class="field mt-12"><label>Delay buzzer → shaker (ms)</label><input id="tagDelay" type="number" min="0" value="45000" /><small class="help">Se mide en milisegundos. Ejemplo: 45000 ms = 45 segundos.</small></div>
          <button class="mt-12" onclick="createTag()">Crear tag</button>
        ` : '<p>Solo superadministrador puede crear tags.</p>'}
      </div>
      <div class="card-block">
        <h3>Gateways</h3>
        ${roleCan('superadministrador') ? `
          <div class="field"><label>MAC del gateway</label><input id="gwMac" placeholder="AA:BB:CC:DD:EE:FF" /></div>
          <div class="field mt-12"><label>Descripción del gateway</label><input id="gwDesc" placeholder="Ej: Gateway cámara 2" /></div>
          <button class="mt-12" onclick="createGateway()">Crear gateway</button>
        ` : '<p>Solo superadministrador puede crear gateways.</p>'}
      </div>
    </div>
    <h3 class="mt-12">Listado de tags</h3>
    ${table(['MAC', 'Descripción', 'Delay (ms / s)', 'Activo', 'Último evento', 'Acciones'], tags.map((t) => {
      const editing = inlineEdit.tags.id === t.id;
      const delay = t.physical_alarm_followup_delay_ms == null ? 45000 : t.physical_alarm_followup_delay_ms;
      if (!editing) return [t.tag_uid, t.model || '', `${delay} / ${(delay / 1000).toFixed(1)} s`, t.active ? '<span class="badge ok">Activo</span>' : '<span class="badge warn">Inactivo</span>', t.updated_at ? formatDateTime(t.updated_at) : '-', roleCan('superadministrador') ? `<button onclick="beginTagInlineEdit('${t.id}')">Editar</button> <button class='danger' onclick="deleteTag('${t.id}')">Borrar</button>` : '-'];
      const d = inlineEdit.tags.draft;
      return [
        `<input value="${esc(d.mac)}" oninput="updateInlineEdit('tags','mac',this.value)"/>`,
        `<input value="${esc(d.descripcion)}" oninput="updateInlineEdit('tags','descripcion',this.value)"/>`,
        `<input type="number" min="0" value="${esc(d.physicalAlarmFollowupDelayMs)}" oninput="updateInlineEdit('tags','physicalAlarmFollowupDelayMs',this.value)"/>`,
        `<select onchange="updateInlineEdit('tags','active',this.value==='true')"><option value="true" ${d.active ? 'selected' : ''}>Activo</option><option value="false" ${!d.active ? 'selected' : ''}>Inactivo</option></select>`,
        '-',
        `<button onclick="saveTagInlineEdit('${t.id}')">Guardar</button> <button class="secondary" onclick="cancelTagInlineEdit()">Cancelar</button>`
      ];
    }))}
    <h3 class="mt-12">Listado de gateways</h3>
    ${table(['MAC', 'Descripción', 'Acciones'], gateways.map((g) => {
      const editing = inlineEdit.gateways.id === g.id;
      if (!editing) return [g.gateway_mac, g.description || '', roleCan('superadministrador') ? `<button onclick="beginGatewayInlineEdit('${g.id}')">Editar</button> <button class='danger' onclick="deleteGateway('${g.id}')">Borrar</button>` : '-'];
      const d = inlineEdit.gateways.draft;
      return [
        `<input value="${esc(d.mac)}" oninput="updateInlineEdit('gateways','mac',this.value)"/>`,
        `<input value="${esc(d.descripcion)}" oninput="updateInlineEdit('gateways','descripcion',this.value)"/>`,
        `<button onclick="saveGatewayInlineEdit('${g.id}')">Guardar</button> <button class="secondary" onclick="cancelGatewayInlineEdit()">Cancelar</button>`
      ];
    }))}
  `;
}

async function createTag() { await api('/tags', { method: 'POST', body: JSON.stringify({ mac: q('tagMac').value, descripcion: q('tagDesc').value, physicalAlarmFollowupDelayMs: Number(q('tagDelay').value || 45000) }) }); toast('Tag creado'); renderInventory(); }
async function createGateway() { await api('/gateways', { method: 'POST', body: JSON.stringify({ mac: q('gwMac').value, descripcion: q('gwDesc').value }) }); toast('Gateway creado'); renderInventory(); }
async function beginTagInlineEdit(id) { const tags = await api('/tags'); const tag = tags.find((t) => t.id === id); if (!tag) return; startInlineEdit('tags', id, { mac: tag.tag_uid, descripcion: tag.model || '', physicalAlarmFollowupDelayMs: (tag.physical_alarm_followup_delay_ms == null ? 45000 : tag.physical_alarm_followup_delay_ms), active: !!tag.active }); renderInventory(); }
function cancelTagInlineEdit() { cancelInlineEdit('tags'); renderInventory(); }
async function saveTagInlineEdit(id) { const d = inlineEdit.tags.draft; const delay = Number(d.physicalAlarmFollowupDelayMs); if (!Number.isFinite(delay) || delay < 0) return toast('Delay inválido', 'error'); await api(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify({ mac: d.mac, descripcion: d.descripcion, active: d.active, physicalAlarmFollowupDelayMs: delay }) }); cancelInlineEdit('tags'); toast('Tag actualizado'); renderInventory(); }
async function beginGatewayInlineEdit(id) { const gateways = await api('/gateways'); const gateway = gateways.find((g) => g.id === id); if (!gateway) return; startInlineEdit('gateways', id, { mac: gateway.gateway_mac, descripcion: gateway.description || '' }); renderInventory(); }
function cancelGatewayInlineEdit() { cancelInlineEdit('gateways'); renderInventory(); }
async function saveGatewayInlineEdit(id) { const d = inlineEdit.gateways.draft; await api(`/gateways/${id}`, { method: 'PATCH', body: JSON.stringify({ mac: d.mac, descripcion: d.descripcion }) }); cancelInlineEdit('gateways'); toast('Gateway actualizado'); renderInventory(); }
async function deleteTag(id) { if (!confirm('¿Borrar tag? Esta acción no se puede deshacer.')) return; try { await api(`/tags/${id}`, { method: 'DELETE' }); toast('Tag borrado'); renderInventory(); } catch (error) { toast(apiErrorMessage(error), 'error'); } }
async function deleteGateway(id) { if (!confirm('¿Borrar gateway? Esta acción no se puede deshacer.')) return; try { await api(`/gateways/${id}`, { method: 'DELETE' }); toast('Gateway borrado'); renderInventory(); } catch (error) { toast(apiErrorMessage(error), 'error'); } }

function renderTagOptions(tags) {
  return tags.filter((t) => t.active).map((t) => `<option value="${t.id}">${esc((t.model || 'Tag sin descripción'))} (${esc(t.tag_uid)})</option>`).join('');
}
function currentWorkerHasTag(workers, workerId) { const w = workers.find((item) => item.id === workerId); return w && w.current_tag_uid; }

async function renderAssignments() {
  const [workers, tags, history] = await Promise.all([api('/workers'), api('/tags'), api('/workers/assignments/history')]);
  q('assignments').innerHTML = `
    <div class="grid two assignment-steps">
      <div class="card-block assignment-step-card create-worker-card">
        <h3>1) Crear trabajador</h3>
        <p class="help">Primero crea el trabajador para poder asignarle un tag.</p>
        <div class="grid two">
          <div class="field"><label>DNI</label><input id="wDni" placeholder="DNI" /></div>
          <div class="field"><label>Nombre completo</label><input id="wName" placeholder="Nombre completo" /></div>
        </div>
        <button class="mt-12 full" onclick="createWorker()">Crear trabajador</button>
      </div>
      <div class="card-block assignment-step-card">
        <h3>2) Asignar tag</h3>
        <p class="help">Si el trabajador ya tenía tag, la asignación anterior se cierra automáticamente.</p>
        <div class="grid two">
          <div class="field"><label>Trabajador</label><select id="asWorker" onchange="showAssignmentWarning()">${workers.map((w) => `<option value="${w.id}">${esc(w.full_name)} (${esc(w.dni)})</option>`).join('')}</select></div>
          <div class="field"><label>Tag</label><select id="asTag">${renderTagOptions(tags)}</select></div>
        </div>
        <div id="assignmentWarning" class="help mt-12"></div>
        <button class="mt-12" onclick="assignTag()">Asignar tag</button>
      </div>
    </div>
    <h3 class="mt-12">Trabajadores registrados</h3>
    ${table(['Nombre', 'DNI', 'Tag actual', 'Rol', 'Activo', 'Acciones'], workers.map((w) => {
      const editing = inlineEdit.workers.id === w.id;
      if (!editing) return [w.full_name, w.dni, w.current_tag_uid || '-', roleLabel(w.role), w.active ? 'Sí' : 'No', `<button onclick="beginWorkerInlineEdit('${w.id}')">Editar</button> ${w.current_tag_uid ? `<button onclick="unassignTag('${w.id}')">Desasignar</button>` : ''} <button class='danger' onclick="deleteWorker('${w.id}')">Borrar</button>`];
      const d = inlineEdit.workers.draft;
      return [
        `<input value="${esc(d.fullName)}" oninput="updateInlineEdit('workers','fullName',this.value)"/>`,
        w.dni,
        w.current_tag_uid || '-',
        `<input value="${esc(d.role)}" oninput="updateInlineEdit('workers','role',this.value)"/>`,
        `<select onchange="updateInlineEdit('workers','active',this.value==='true')"><option value="true" ${d.active ? 'selected' : ''}>Sí</option><option value="false" ${!d.active ? 'selected' : ''}>No</option></select>`,
        `<button onclick="saveWorkerInlineEdit('${w.id}')">Guardar</button> <button class="secondary" onclick="cancelWorkerInlineEdit()">Cancelar</button>`
      ];
    }))}
    <h3 class="mt-12">Histórico de asignaciones</h3>
    ${table(['Trabajador', 'Tag', 'Inicio', 'Fin'], history.map((h) => [h.worker_name, h.tag_mac, formatDateTime(h.assigned_at), h.unassigned_at ? formatDateTime(h.unassigned_at) : '-']))}
  `;
  showAssignmentWarning(workers);
}

function showAssignmentWarning(workers) {
  const allWorkers = workers || [];
  const workerId = q('asWorker')?.value;
  const warningEl = q('assignmentWarning');
  if (!warningEl || !workerId) return;
  const assigned = currentWorkerHasTag(allWorkers, workerId);
  warningEl.innerHTML = assigned ? `<span class="badge warn assignment-warning">Atención: este trabajador ya tiene tag (${esc(assigned)}). Se reasignará automáticamente.</span>` : '<span class="badge ok assignment-warning">Trabajador sin tag asignado actualmente.</span>';
}

async function createWorker() { await api('/workers', { method: 'POST', body: JSON.stringify({ dni: q('wDni').value, fullName: q('wName').value, role: 'trabajador' }) }); toast('Trabajador creado'); renderAssignments(); }
async function assignTag() { await api(`/workers/${q('asWorker').value}/assign-tag`, { method: 'POST', body: JSON.stringify({ tagId: q('asTag').value }) }); toast('Tag asignado'); renderAssignments(); }
async function beginWorkerInlineEdit(id) { const workers = await api('/workers'); const worker = workers.find((w) => w.id === id); if (!worker) return; startInlineEdit('workers', id, { fullName: worker.full_name, role: worker.role || 'trabajador', active: !!worker.active }); renderAssignments(); }
function cancelWorkerInlineEdit() { cancelInlineEdit('workers'); renderAssignments(); }
async function saveWorkerInlineEdit(id) { const d = inlineEdit.workers.draft; await api(`/workers/${id}`, { method: 'PATCH', body: JSON.stringify({ fullName: d.fullName, role: d.role, active: d.active }) }); cancelInlineEdit('workers'); toast('Trabajador actualizado'); renderAssignments(); }
async function unassignTag(workerId) { if (!confirm('¿Desasignar tag activo del trabajador?')) return; try { await api(`/workers/${workerId}/unassign-tag`, { method: 'POST' }); toast('Tag desasignado'); renderAssignments(); } catch (error) { toast(apiErrorMessage(error), 'error'); } }
async function deleteWorker(id) { if (!confirm('¿Borrar trabajador?')) return; try { await api(`/workers/${id}`, { method: 'DELETE' }); toast('Trabajador borrado'); renderAssignments(); } catch (error) { toast(apiErrorMessage(error), 'error'); } }

async function archiveAlert(id) {
  if (!confirm('¿Archivar alarma seleccionada?')) return;
  await api(`/alerts/${id}/archive`, { method: 'POST' });
  toast('Alerta archivada');
  renderAlertsCenter();
}

function exportAlertsCsv() {
  if (!alertsCache.length) return toast('No hay alertas para exportar', 'warning');
  const rows = alertsCache.map((a) => [formatDateTime(a.created_at), a.worker_name, a.worker_dni, a.tag_uid, a.cold_room_name, alertTypeLabel(a.alert_type), severityLabel(a.severity), a.message, a.status]);
  const csv = ['Fecha,Trabajador,DNI,Tag,Cámara,Tipo,Severidad,Mensaje,Estado', ...rows.map((r) => r.map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'alertas-filtradas.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function toggleAlertSelection(id, checked) {
  if (checked) alertsUI.selected.add(id);
  else alertsUI.selected.delete(id);
}

async function archiveSelectedAlerts() {
  if (!alertsUI.selected.size) return toast('Selecciona al menos una alerta', 'warning');
  if (!confirm(`¿Archivar ${alertsUI.selected.size} alertas seleccionadas?`)) return;
  const ids = [...alertsUI.selected];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await api(`/alerts/${id}/archive`, { method: 'POST' });
  }
  alertsUI.selected.clear();
  toast('Alertas archivadas');
  renderAlertsCenter();
}

function bindAlertsReactiveFilters() {
  ['acState', 'acSeverity', 'acSearch'].forEach((id) => {
    const el = q(id);
    if (el) el.addEventListener('input', () => { alertsUI.page = 1; renderAlertsCenter(); });
    if (el) el.addEventListener('change', () => { alertsUI.page = 1; renderAlertsCenter(); });
  });
}

async function renderAlertsCenter() {
  const state = (q('acState') && q('acState').value) || 'active';
  const severity = (q('acSeverity') && q('acSeverity').value) || '';
  const search = (q('acSearch') && q('acSearch').value.trim()) || '';
  const query = new URLSearchParams();
  if (state && state !== 'all') query.set('state', state);
  if (severity) query.set('severity', severity);
  if (search) query.set('search', search);
  const alerts = await api(`/alerts?${query.toString()}`);
  alertsCache = alerts;
  const showCamera = alerts.some((a) => a.cold_room_name && a.cold_room_name !== '-');
  const start = (alertsUI.page - 1) * alertsUI.pageSize;
  const paged = alerts.slice(start, start + alertsUI.pageSize);
  const totalPages = Math.max(1, Math.ceil(alerts.length / alertsUI.pageSize));

  const headers = ['Sel', 'Fecha', 'Trabajador', 'DNI', 'Tag'];
  if (showCamera) headers.push('Cámara');
  headers.push('Tipo', 'Severidad', 'Mensaje', 'Estado', 'Archivado por', 'Acciones');

  q('alertsCenter').innerHTML = `
    <div class="grid three">
      <div class="field"><label>Estado</label><select id="acState"><option value="active" ${state === 'active' ? 'selected' : ''}>Activas</option><option value="archived" ${state === 'archived' ? 'selected' : ''}>Archivadas</option><option value="all" ${state === 'all' ? 'selected' : ''}>Todas</option></select></div>
      <div class="field"><label>Severidad</label><select id="acSeverity"><option value="">Todas</option><option value="critical" ${severity === 'critical' ? 'selected' : ''}>Crítica</option><option value="warning" ${severity === 'warning' ? 'selected' : ''}>Advertencia</option><option value="info" ${severity === 'info' ? 'selected' : ''}>Info</option></select></div>
      <div class="field"><label>Búsqueda</label><input id="acSearch" placeholder="Trabajador / tag / cámara / mensaje" value="${esc(search)}" /></div>
    </div>
    <div class="actions mt-12 alerts-bulk-actions">
      <div class="alerts-top-actions">
        <button class="secondary" onclick="renderAlertsCenter()">Refrescar</button>
        <button onclick="exportAlertsCsv()">Exportar CSV</button>
      </div>
      <button class="warning btn-archivar-seleccionadas" onclick="archiveSelectedAlerts()">Archivar seleccionadas (${alertsUI.selected.size})</button>
      <span class="help">Filtros reactivos: se aplican automáticamente.</span>
    </div>
    ${table(headers, paged.map((a) => {
      const row = [`<input type="checkbox" ${alertsUI.selected.has(a.id) ? 'checked' : ''} onchange="toggleAlertSelection('${a.id}', this.checked)"/>`, formatDateTime(a.created_at), a.worker_name, a.worker_dni, a.tag_uid];
      if (showCamera) row.push(a.cold_room_name || '-');
      row.push(alertTypeLabel(a.alert_type), severityBadge(a.severity), a.message, a.status === 'active' ? '<span class="badge warn">Activa</span>' : '<span class="badge archived">Archivada</span>', a.acknowledged_by || '-', a.status === 'active' ? `<button class="btn-archive" aria-label="Archivar" onclick="archiveAlert('${a.id}')">Archivar</button>` : '-');
      return row;
    }), 'alerts-mobile-compact')}
    <div class="actions mt-12">
      <button class="secondary" ${alertsUI.page <= 1 ? 'disabled' : ''} onclick="alertsUI.page=Math.max(1,alertsUI.page-1);renderAlertsCenter();">← Anterior</button>
      <span class="badge info">Página ${alertsUI.page} de ${totalPages} · ${alerts.length} alertas</span>
      <button class="secondary" ${alertsUI.page >= totalPages ? 'disabled' : ''} onclick="alertsUI.page=Math.min(${totalPages},alertsUI.page+1);renderAlertsCenter();">Siguiente →</button>
    </div>
  `;
  bindAlertsReactiveFilters();
}

async function renderAlarms() {
  const rules = await api('/alarm-rules');
  q('alarms').innerHTML = `
    <p class="help">Si hay varias reglas activas, el sistema evalúa la que corresponda al contexto operativo vigente.</p>
    <div class="grid four alarms-form-row">
      <div class="field"><label>Descripción</label><input id="aDesc" placeholder="Descripción" /></div>
      <div class="field"><label>Minutos para buzzer/shaker</label><input id="aBuzz" type="number" min="1" placeholder="Ej: 15" /><small class="help">Tiempo hasta aviso inicial físico.</small></div>
      <div class="field"><label>Minutos para alarma</label><input id="aAlarm" type="number" min="1" placeholder="Ej: 45" /><small class="help">Tiempo hasta alarma crítica.</small></div>
      <div class="field"><label>Minutos de gracia fuera</label><input id="aGrace" type="number" min="1" value="15" /><small class="help">Tiempo de visibilidad al salir de cámara.</small></div>
    </div>
    <button class="mt-12" onclick="createAlarmRule()">Crear regla</button>
    ${table(['Descripción', 'Min buzzer/shaker', 'Min alarma', 'Min gracia fuera', 'Estado', 'Acciones'], rules.map((r) => {
      const editing = inlineEdit.alarmRules.id === r.id;
      if (!editing) return [r.description, r.buzzer_shaker_minutes, r.alarm_minutes, (r.alarm_visibility_grace_minutes == null ? 15 : r.alarm_visibility_grace_minutes), r.active ? '<span class="badge ok">Activa</span>' : '<span class="badge warn">Inactiva</span>', `<button onclick="beginAlarmRuleInlineEdit('${r.id}')">Editar</button> <button class="${r.active ? 'warning' : 'success'}" onclick="toggleAlarm('${r.id}', ${!r.active})">${r.active ? 'Apagar' : 'Activar'}</button> <button class='danger' onclick="deleteAlarm('${r.id}')">Eliminar</button>`];
      const d = inlineEdit.alarmRules.draft;
      return [
        `<input value="${esc(d.descripcion)}" oninput="updateInlineEdit('alarmRules','descripcion',this.value)"/>`,
        `<input type="number" min="1" value="${esc(d.minutosBuzzerShaker)}" oninput="updateInlineEdit('alarmRules','minutosBuzzerShaker',this.value)"/>`,
        `<input type="number" min="1" value="${esc(d.minutosAlarma)}" oninput="updateInlineEdit('alarmRules','minutosAlarma',this.value)"/>`,
        `<input type="number" min="1" value="${esc(d.minutosGraciaFuera)}" oninput="updateInlineEdit('alarmRules','minutosGraciaFuera',this.value)"/>`,
        `<select onchange="updateInlineEdit('alarmRules','active',this.value==='true')"><option value="true" ${d.active ? 'selected' : ''}>Activa</option><option value="false" ${!d.active ? 'selected' : ''}>Inactiva</option></select>`,
        `<button onclick="saveAlarmRuleInlineEdit('${r.id}')">Guardar</button> <button class="secondary" onclick="cancelAlarmRuleInlineEdit()">Cancelar</button>`
      ];
    }))}
  `;
}

async function beginAlarmRuleInlineEdit(id) {
  const rules = await api('/alarm-rules');
  const rule = rules.find((r) => r.id === id);
  if (!rule) return;
  startInlineEdit('alarmRules', id, {
    descripcion: rule.description,
    minutosBuzzerShaker: rule.buzzer_shaker_minutes,
    minutosAlarma: rule.alarm_minutes,
    minutosGraciaFuera: (rule.alarm_visibility_grace_minutes == null ? 15 : rule.alarm_visibility_grace_minutes),
    active: !!rule.active
  });
  renderAlarms();
}
function cancelAlarmRuleInlineEdit() { cancelInlineEdit('alarmRules'); renderAlarms(); }
async function saveAlarmRuleInlineEdit(id) {
  const d = inlineEdit.alarmRules.draft;
  const minutosBuzzerShaker = Number(d.minutosBuzzerShaker);
  const minutosAlarma = Number(d.minutosAlarma);
  const minutosGraciaFuera = Number(d.minutosGraciaFuera);
  if (![minutosBuzzerShaker, minutosAlarma, minutosGraciaFuera].every((v) => Number.isFinite(v) && v > 0)) return toast('Valores numéricos inválidos', 'error');
  if (minutosBuzzerShaker >= minutosAlarma) return toast('La prealarma (buzzer) debe ser menor que la alarma.', 'error');
  await api(`/alarm-rules/${id}`, { method: 'PATCH', body: JSON.stringify({ descripcion: d.descripcion, minutosBuzzerShaker, minutosAlarma, minutosGraciaFuera, active: d.active }) });
  cancelInlineEdit('alarmRules');
  toast('Regla actualizada');
  renderAlarms();
}
async function createAlarmRule() {
  const minutosBuzzerShaker = Number(q('aBuzz').value);
  const minutosAlarma = Number(q('aAlarm').value);
  const minutosGraciaFuera = Number(q('aGrace').value || 15);
  if (minutosBuzzerShaker >= minutosAlarma) return toast('La prealarma (buzzer) debe ser menor que la alarma.', 'error');
  await api('/alarm-rules', { method: 'POST', body: JSON.stringify({ descripcion: q('aDesc').value, minutosBuzzerShaker, minutosAlarma, minutosGraciaFuera }) });
  toast('Regla creada');
  renderAlarms();
}
async function toggleAlarm(id, active) { await api(`/alarm-rules/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }); toast(`Regla ${active ? 'activada' : 'apagada'}`); renderAlarms(); }
async function deleteAlarm(id) { if (!confirm('¿Eliminar regla de alarma?')) return; try { await api(`/alarm-rules/${id}`, { method: 'DELETE' }); toast('Regla eliminada'); renderAlarms(); } catch (error) { toast(apiErrorMessage(error), 'error'); } }

async function renderReports() {
  const from = q('rFrom')?.value || '';
  const to = q('rTo')?.value || '';
  const worker = q('rWorker')?.value || '';
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (worker) query.set('workerDni', worker);
  const queryText = query.toString() ? `?${query.toString()}` : '';

  q('reports').innerHTML = `
    <p>Genera informes de inspección con el periodo seleccionado. PDF para revisión documental y Excel para análisis operativo.</p>
    <div class="grid three">
      <div class="field"><label>Desde</label><input id="rFrom" type="date" value="${esc(from)}" /></div>
      <div class="field"><label>Hasta</label><input id="rTo" type="date" value="${esc(to)}" /></div>
      <div class="field"><label>Filtrar por DNI (opcional)</label><input id="rWorker" placeholder="Ej: 12345678A" value="${esc(worker)}" /></div>
    </div>
    <p class="help mt-12">Periodo seleccionado: ${from || 'inicio'} → ${to || 'hoy'} ${worker ? `· DNI: ${esc(worker)}` : ''}</p>
    <div class="actions report-actions">
      <button class="report-btn report-btn-pdf" onclick="downloadReport('/reports/inspection.pdf${queryText}','inspection.pdf', this)">Descargar PDF (auditoría)</button>
      <button class="report-btn report-btn-excel" onclick="downloadReport('/reports/inspection.xlsx${queryText}','inspection.xlsx', this)">Descargar Excel (análisis)</button>
      <button class="report-btn report-btn-refresh" onclick="renderReports()">Actualizar filtros</button>
    </div>
  `;
}

async function downloadReport(url, filename, button) {
  const previous = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = 'Generando...'; }
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('No se pudo descargar el informe');
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(href);
    toast('Informe generado correctamente');
  } catch (error) {
    toast(apiErrorMessage(error), 'error');
  } finally {
    if (button) { button.disabled = false; button.textContent = previous; }
  }
}

function startRealtime() {
  if (realtimeSource) realtimeSource.close();
  realtimeSource = new EventSource(`/realtime/stream?access_token=${encodeURIComponent(token)}`);
  realtimeSource.addEventListener('snapshot', (event) => {
    const payload = JSON.parse(event.data);
    lastSnapshot = payload;
    setSessionText(`· dentro: ${payload.totals.workersInside} · alertas: <a class="header-alert-badge" href="#" onclick="showSection('alertsCenter');return false;">${payload.totals.activeAlerts}</a>`);
    if (!q('dashboard').hidden) renderDashboard(payload);
  });
  realtimeSource.onerror = () => {
    setGlobalStatus('<span class="badge alert">Conexión en tiempo real no disponible. Reintentando…</span>');
  };
}

(function wireLoginForm() {
  renderNav();
  const form = q('loginForm');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try { await login(); } catch (error) { toast(apiErrorMessage(error), 'error'); }
    });
  }
  const menuToggle = q('menuToggle');
  if (window.innerWidth <= 768) q('mainTabs').classList.remove('open');
  if (menuToggle) menuToggle.addEventListener('click', () => q('mainTabs').classList.toggle('open'));
})();

(async function bootstrap() {
  const resetToken = new URLSearchParams(window.location.search).get('reset_token');
  if (resetToken) q('rpToken').value = resetToken;
  if (!token) return;
  try {
    currentUser = await api('/auth/me');
    q('loginView').hidden = true;
    q('loginView').style.display = 'none';
    q('appView').hidden = false;
    q('appView').style.display = 'block';
    setSessionText();
    startRealtime();
    showSection('dashboard');
  } catch {
    localStorage.removeItem('cc_token');
    token = '';
  }
})();
