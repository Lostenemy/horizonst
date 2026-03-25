let token = localStorage.getItem('cc_token') || '';
let currentUser = null;
let realtimeSource = null;

const q = (id) => document.getElementById(id);
const sections = ['dashboard', 'users', 'inventory', 'assignments', 'alertsCenter', 'alarms', 'reports'];

const inlineEdit = {
  users: { id: null, draft: null },
  tags: { id: null, draft: null },
  gateways: { id: null, draft: null },
  workers: { id: null, draft: null },
  alarmRules: { id: null, draft: null }
};

function startInlineEdit(scope, id, draft) {
  inlineEdit[scope] = { id, draft: { ...draft } };
}

function cancelInlineEdit(scope) {
  inlineEdit[scope] = { id: null, draft: null };
}

function updateInlineEdit(scope, field, value) {
  if (!inlineEdit[scope].draft) return;
  inlineEdit[scope].draft[field] = value;
}

function esc(value) {
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
}

function apiErrorMessage(error) {
  const raw = String(error && error.message ? error.message : error || '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.message) return parsed.message;
  } catch {}
  return raw || 'Error inesperado';
}

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

function showSection(section) {
  sections.forEach((s) => (q(s).hidden = s !== section));
  if (section === 'dashboard') renderDashboard();
  if (section === 'users') renderUsers();
  if (section === 'inventory') renderInventory();
  if (section === 'assignments') renderAssignments();
  if (section === 'alertsCenter') renderAlertsCenter();
  if (section === 'alarms') renderAlarms();
  if (section === 'reports') renderReports();
}

function setSessionText(extra = '') {
  q('sessionBox').innerHTML = currentUser
    ? `<b>${currentUser.email}</b><br><small>${currentUser.role} ${extra}</small><br><button class="secondary mt-12" onclick="logout()">Salir</button>`
    : '';
}

async function login() {
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: q('username').value, password: q('password').value })
  });
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
  await api('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: q('fpEmail').value })
  });
  alert('Si el email existe y está activo, se ha enviado un correo de recuperación.');
}

async function resetPassword() {
  await api('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: q('rpToken').value, newPassword: q('rpPass').value })
  });
  alert('Contraseña actualizada.');
}

function stateBadge(state) {
  if (state === 'alarma') return '<span class=\"badge alert\">alarma</span>';
  if (state === 'dentro') return '<span class=\"badge warn\">dentro</span>';
  return '<span class=\"badge ok\">fuera</span>';
}

function severityBadge(severity) {
  if (severity === 'critical') return '<span class=\"badge alert\">crítica</span>';
  if (severity === 'warning') return '<span class=\"badge warn\">warning</span>';
  return '<span class=\"badge ok\">info</span>';
}

function table(headers, rows) {
  const body = rows.length
    ? rows
        .map(
          (r) =>
            `<tr>${r
              .map((c, idx) => `<td data-label="${headers[idx] || ''}">${c == null ? '' : c}</td>`)
              .join('')}</tr>`
        )
        .join('')
    : '<tr><td colspan="99">Sin datos</td></tr>';
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

async function renderDashboard(snapshot) {
  const data = snapshot || (await api('/realtime/snapshot'));
  const workersRows = data.workersInside.map((w) => [
    w.full_name,
    w.dni,
    w.tag_uid,
    Math.floor(w.elapsed_seconds / 60),
    stateBadge(w.presence_status)
  ]);
  const alertsRows = data.activeAlerts.map((a) => [a.alert_type, a.severity, a.message, new Date(a.created_at).toLocaleString()]);

  q('dashboard').innerHTML = `
    <h2>Dashboard operativo</h2>
    <div class="metrics">
      <div class="metric"><small>Trabajadores detectados dentro</small><b>${data.totals.workersInside}</b></div>
      <div class="metric"><small>Alarmas activas (disparadas)</small><b>${data.totals.activeAlerts}</b></div>
      <div class="metric"><small>Última actualización</small><b style="font-size:14px">${new Date(data.ts).toLocaleTimeString()}</b></div>
    </div>
    <p class="muted">Nota: este panel muestra alarmas/incidencias realmente disparadas, no reglas de configuración.</p>
    <h3>Trabajadores dentro (presencia real)</h3>
    ${table(['Trabajador', 'DNI', 'Tag', 'Min dentro', 'Estado'], workersRows)}
    <h3 class="mt-12">Alarmas activas (disparadas)</h3>
    ${table(['Tipo', 'Severidad', 'Mensaje', 'Fecha'], alertsRows)}
  `;
}

async function renderUsers() {
  if (!roleCan('administrador')) {
    q('users').innerHTML = '<p>Sin permisos para gestionar usuarios.</p>';
    return;
  }
  const users = await api('/users');
  q('users').innerHTML = `
    <h2>Gestión de usuarios</h2>
    <div class="grid three">
      <input id="uNombre" placeholder="Nombre" />
      <input id="uApellidos" placeholder="Apellidos" />
      <input id="uEmail" placeholder="Email" />
      <input id="uTelefono" placeholder="Teléfono" />
      <input id="uDni" placeholder="DNI" />
      <select id="uRol"><option value="supervisor">supervisor</option><option value="administrador">administrador</option></select>
      <select id="uEstado"><option value="active">active</option><option value="inactive">inactive</option></select>
      <input id="uPass" placeholder="Contraseña" />
      <input id="uTurno" placeholder="Turno" />
    </div>
    <button class="mt-12" onclick="createUser()">Crear usuario</button>
    ${table(['Nombre', 'Email', 'Rol', 'Estado', 'Teléfono', 'DNI', 'Turno', 'Acciones'], users.map((u) => {
      const isEditing = inlineEdit.users.id === u.id;
      if (!isEditing) {
        return [
          `${u.first_name} ${u.last_name}`,
          u.email,
          u.role,
          u.status,
          u.phone || '-',
          u.dni,
          u.shift || '-',
          `<button onclick="beginUserInlineEdit('${u.id}')">Editar</button> <button onclick="deactivateUser('${u.id}')">Desactivar</button>${roleCan('superadministrador') ? ` <button class='danger' onclick="deleteUser('${u.id}')">Borrar</button>` : ''}`
        ];
      }
      const d = inlineEdit.users.draft;
      return [
        `<input value="${esc(d.nombre)}" oninput="updateInlineEdit('users','nombre',this.value)"/> <input class="mt-12" value="${esc(d.apellidos)}" oninput="updateInlineEdit('users','apellidos',this.value)"/>`,
        `<input value="${esc(d.email)}" oninput="updateInlineEdit('users','email',this.value)"/>`,
        `<select onchange="updateInlineEdit('users','rol',this.value)"><option value="supervisor" ${d.rol === 'supervisor' ? 'selected' : ''}>supervisor</option><option value="administrador" ${d.rol === 'administrador' ? 'selected' : ''}>administrador</option></select>`,
        `<select onchange="updateInlineEdit('users','estado',this.value)"><option value="active" ${d.estado === 'active' ? 'selected' : ''}>active</option><option value="inactive" ${d.estado === 'inactive' ? 'selected' : ''}>inactive</option></select>`,
        `<input value="${esc(d.telefono)}" oninput="updateInlineEdit('users','telefono',this.value)"/>`,
        `<input value="${esc(d.dni)}" oninput="updateInlineEdit('users','dni',this.value)"/>`,
        `<input value="${esc(d.turno)}" oninput="updateInlineEdit('users','turno',this.value)"/>`,
        `<input type="password" placeholder="Nueva contraseña (opcional)" oninput="updateInlineEdit('users','password',this.value)"/> <div class='mt-12'><button onclick="saveUserInlineEdit('${u.id}')">Guardar</button> <button class="secondary" onclick="cancelUserInlineEdit()">Cancelar</button></div>`
      ];
    }))}
  `;
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
    turno: user.shift || '',
    password: ''
  });
  renderUsers();
}

function cancelUserInlineEdit() {
  cancelInlineEdit('users');
  renderUsers();
}

async function saveUserInlineEdit(id) {
  const d = inlineEdit.users.draft;
  await api(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      nombre: d.nombre,
      apellidos: d.apellidos,
      email: d.email,
      telefono: d.telefono || null,
      dni: d.dni,
      rol: d.rol,
      estado: d.estado,
      turno: d.turno || null,
      password: d.password || null
    })
  });
  cancelInlineEdit('users');
  renderUsers();
}

async function deactivateUser(id) { await api(`/users/${id}/deactivate`, { method: 'POST' }); renderUsers(); }
async function deleteUser(id) { if (confirm('¿Borrar usuario?')) { await api(`/users/${id}`, { method: 'DELETE' }); renderUsers(); } }

async function renderInventory() {
  const [tags, gateways] = await Promise.all([api('/tags'), api('/gateways')]);
  q('inventory').innerHTML = `
    <h2>Gestión de gateways y tags</h2>
    ${roleCan('superadministrador') ? `
    <div class="grid two">
      <div>
        <h3>Alta tag</h3>
        <input id="tagMac" placeholder="MAC" />
        <input id="tagDesc" placeholder="Descripción" class="mt-12" />
        <input id="tagDelay" type="number" min="0" placeholder="Delay buzzer→shaker (ms)" class="mt-12" value="45000" />
        <button class="mt-12" onclick="createTag()">Crear tag</button>
      </div>
      <div>
        <h3>Alta gateway</h3>
        <input id="gwMac" placeholder="MAC" />
        <input id="gwDesc" placeholder="Descripción" class="mt-12" />
        <button class="mt-12" onclick="createGateway()">Crear gateway</button>
      </div>
    </div>` : '<p>Solo superadministrador puede asignar MAC de tags y gateways.</p>'}
    <h3>Tags</h3>
    ${table(['MAC', 'Descripción', 'Delay buzzer→shaker (ms)', 'Activo', 'Acciones'], tags.map((t) => {
      const editing = inlineEdit.tags.id === t.id;
      if (!editing) return [t.tag_uid, t.model || '', (t.physical_alarm_followup_delay_ms == null ? 45000 : t.physical_alarm_followup_delay_ms), t.active ? 'sí' : 'no', roleCan('superadministrador') ? `<button onclick="beginTagInlineEdit('${t.id}')">Editar</button> <button class='danger' onclick="deleteTag('${t.id}')">Borrar</button>` : '-'];
      const d = inlineEdit.tags.draft;
      return [
        `<input value="${esc(d.mac)}" oninput="updateInlineEdit('tags','mac',this.value)"/>`,
        `<input value="${esc(d.descripcion)}" oninput="updateInlineEdit('tags','descripcion',this.value)"/>`,
        `<input type="number" min="0" value="${esc(d.physicalAlarmFollowupDelayMs)}" oninput="updateInlineEdit('tags','physicalAlarmFollowupDelayMs',this.value)"/>`,
        `<select onchange="updateInlineEdit('tags','active',this.value==='true')"><option value="true" ${d.active ? 'selected' : ''}>sí</option><option value="false" ${!d.active ? 'selected' : ''}>no</option></select>`,
        `<button onclick="saveTagInlineEdit('${t.id}')">Guardar</button> <button class="secondary" onclick="cancelTagInlineEdit()">Cancelar</button>`
      ];
    }))}
    <h3 class="mt-12">Gateways</h3>
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

async function createTag() { await api('/tags', { method: 'POST', body: JSON.stringify({ mac: q('tagMac').value, descripcion: q('tagDesc').value, physicalAlarmFollowupDelayMs: Number(q('tagDelay').value || 45000) }) }); renderInventory(); }
async function createGateway() { await api('/gateways', { method: 'POST', body: JSON.stringify({ mac: q('gwMac').value, descripcion: q('gwDesc').value }) }); renderInventory(); }

async function beginTagInlineEdit(id) {
  const tags = await api('/tags');
  const tag = tags.find((t) => t.id === id);
  if (!tag) return;
  startInlineEdit('tags', id, {
    mac: tag.tag_uid,
    descripcion: tag.model || '',
    physicalAlarmFollowupDelayMs: (tag.physical_alarm_followup_delay_ms == null ? 45000 : tag.physical_alarm_followup_delay_ms),
    active: !!tag.active
  });
  renderInventory();
}

function cancelTagInlineEdit() { cancelInlineEdit('tags'); renderInventory(); }

async function saveTagInlineEdit(id) {
  const d = inlineEdit.tags.draft;
  const delay = Number(d.physicalAlarmFollowupDelayMs);
  if (!Number.isFinite(delay) || delay < 0) return alert('Delay inválido');
  await api(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify({ mac: d.mac, descripcion: d.descripcion, active: d.active, physicalAlarmFollowupDelayMs: delay }) });
  cancelInlineEdit('tags');
  renderInventory();
}

async function beginGatewayInlineEdit(id) {
  const gateways = await api('/gateways');
  const gateway = gateways.find((g) => g.id === id);
  if (!gateway) return;
  startInlineEdit('gateways', id, { mac: gateway.gateway_mac, descripcion: gateway.description || '' });
  renderInventory();
}

function cancelGatewayInlineEdit() { cancelInlineEdit('gateways'); renderInventory(); }

async function saveGatewayInlineEdit(id) {
  const d = inlineEdit.gateways.draft;
  await api(`/gateways/${id}`, { method: 'PATCH', body: JSON.stringify({ mac: d.mac, descripcion: d.descripcion }) });
  cancelInlineEdit('gateways');
  renderInventory();
}

async function deleteTag(id) {
  if (!confirm('¿Borrar tag?')) return;
  try {
    await api(`/tags/${id}`, { method: 'DELETE' });
    renderInventory();
  } catch (error) {
    alert(apiErrorMessage(error));
  }
}

async function deleteGateway(id) {
  if (!confirm('¿Borrar gateway?')) return;
  try {
    await api(`/gateways/${id}`, { method: 'DELETE' });
    renderInventory();
  } catch (error) {
    alert(apiErrorMessage(error));
  }
}

async function renderAssignments() {
  const [workers, tags, history] = await Promise.all([api('/workers'), api('/tags'), api('/workers/assignments/history')]);
  q('assignments').innerHTML = `
    <h2>Asignación de tags a trabajadores</h2>
    <p>Un trabajador no puede tener dos tags simultáneos. El cambio cierra la asignación anterior.</p>

    <h3>Alta rápida de trabajador</h3>
    <div class="grid three">
      <input id="wDni" placeholder="DNI" />
      <input id="wName" placeholder="Nombre completo" />
      <button onclick="createWorker()">Crear trabajador</button>
    </div>

    <h3 class="mt-12">Asignar tag</h3>
    <div class="grid two">
      <select id="asWorker">${workers.map((w) => `<option value="${w.id}">${w.full_name} (${w.dni})</option>`).join('')}</select>
      <select id="asTag">${tags.filter((t) => t.active).map((t) => `<option value="${t.id}">${t.tag_uid}</option>`).join('')}</select>
    </div>
    <button class="mt-12" onclick="assignTag()">Asignar tag</button>

    <h3 class="mt-12">Trabajadores registrados</h3>
    ${table(['Nombre', 'DNI', 'Tag actual', 'Rol', 'Activo', 'Acciones'], workers.map((w) => {
      const editing = inlineEdit.workers.id === w.id;
      if (!editing) return [w.full_name, w.dni, w.current_tag_uid || '-', w.role || '-', w.active ? 'sí' : 'no', `<button onclick="beginWorkerInlineEdit('${w.id}')">Editar</button> ${w.current_tag_uid ? `<button onclick=\"unassignTag('${w.id}')\">Desasignar</button>` : ''} <button class='danger' onclick="deleteWorker('${w.id}')">Borrar</button>`];
      const d = inlineEdit.workers.draft;
      return [
        `<input value="${esc(d.fullName)}" oninput="updateInlineEdit('workers','fullName',this.value)"/>`,
        w.dni,
        w.current_tag_uid || '-',
        `<input value="${esc(d.role)}" oninput="updateInlineEdit('workers','role',this.value)"/>`,
        `<select onchange="updateInlineEdit('workers','active',this.value==='true')"><option value="true" ${d.active ? 'selected' : ''}>sí</option><option value="false" ${!d.active ? 'selected' : ''}>no</option></select>`,
        `<button onclick="saveWorkerInlineEdit('${w.id}')">Guardar</button> <button class="secondary" onclick="cancelWorkerInlineEdit()">Cancelar</button>`
      ];
    }))}

    <h3 class="mt-12">Histórico de asignaciones</h3>
    ${table(['Trabajador', 'Tag', 'Inicio', 'Fin'], history.map((h) => [h.worker_name, h.tag_mac, new Date(h.assigned_at).toLocaleString(), h.unassigned_at ? new Date(h.unassigned_at).toLocaleString() : '-']))}
  `;
}

async function createWorker() {
  await api('/workers', {
    method: 'POST',
    body: JSON.stringify({ dni: q('wDni').value, fullName: q('wName').value, role: 'trabajador' })
  });
  renderAssignments();
}

async function assignTag() {
  await api(`/workers/${q('asWorker').value}/assign-tag`, {
    method: 'POST',
    body: JSON.stringify({ tagId: q('asTag').value })
  });
  renderAssignments();
}

async function beginWorkerInlineEdit(id) {
  const workers = await api('/workers');
  const worker = workers.find((w) => w.id === id);
  if (!worker) return;
  startInlineEdit('workers', id, { fullName: worker.full_name, role: worker.role || 'trabajador', active: !!worker.active });
  renderAssignments();
}

function cancelWorkerInlineEdit() { cancelInlineEdit('workers'); renderAssignments(); }

async function saveWorkerInlineEdit(id) {
  const d = inlineEdit.workers.draft;
  await api(`/workers/${id}`, { method: 'PATCH', body: JSON.stringify({ fullName: d.fullName, role: d.role, active: d.active }) });
  cancelInlineEdit('workers');
  renderAssignments();
}

async function unassignTag(workerId) {
  if (!confirm('¿Desasignar tag activo del trabajador?')) return;
  try {
    await api(`/workers/${workerId}/unassign-tag`, { method: 'POST' });
    renderAssignments();
  } catch (error) {
    alert(apiErrorMessage(error));
  }
}

async function deleteWorker(id) {
  if (!confirm('¿Borrar trabajador?')) return;
  try {
    await api(`/workers/${id}`, { method: 'DELETE' });
    renderAssignments();
  } catch (error) {
    alert(apiErrorMessage(error));
  }
}


async function archiveAlert(id) {
  if (!confirm('¿Archivar alarma seleccionada?')) return;
  await api(`/alerts/${id}/archive`, { method: 'POST' });
  renderAlertsCenter();
}

async function renderAlertsCenter() {
  const acStateEl = q('acState');
  const state = (acStateEl && acStateEl.value) || 'active';
  const acSeverityEl = q('acSeverity');
  const severity = (acSeverityEl && acSeverityEl.value) || '';
  const acSearchEl = q('acSearch');
  const search = (acSearchEl && typeof acSearchEl.value === 'string' ? acSearchEl.value.trim() : '') || '';
  const query = new URLSearchParams();
  if (state && state !== 'all') query.set('state', state);
  if (severity) query.set('severity', severity);
  if (search) query.set('search', search);

  const alerts = await api(`/alerts?${query.toString()}`);

  q('alertsCenter').innerHTML = `
    <h2>Gestión de alarmas disparadas</h2>
    <div class="grid three">
      <select id="acState">
        <option value="active" ${state === 'active' ? 'selected' : ''}>Activas</option>
        <option value="archived" ${state === 'archived' ? 'selected' : ''}>Archivadas</option>
        <option value="all" ${state === 'all' ? 'selected' : ''}>Todas</option>
      </select>
      <select id="acSeverity">
        <option value="" ${severity === '' ? 'selected' : ''}>Todas las severidades</option>
        <option value="critical" ${severity === 'critical' ? 'selected' : ''}>Crítica</option>
        <option value="warning" ${severity === 'warning' ? 'selected' : ''}>Warning</option>
        <option value="info" ${severity === 'info' ? 'selected' : ''}>Info</option>
      </select>
      <input id="acSearch" placeholder="Buscar trabajador / tag / cámara / mensaje" value="${search.replace(/"/g, '&quot;')}" />
    </div>
    <div class="actions mt-12">
      <button onclick="renderAlertsCenter()">Aplicar filtros</button>
      <button class="secondary" onclick="showSection('alertsCenter')">Refrescar</button>
    </div>
    ${table(
      ['Fecha', 'Trabajador', 'DNI', 'Tag', 'Cámara', 'Tipo', 'Severidad', 'Mensaje', 'Estado', 'Archivado por', 'Acciones'],
      alerts.map((a) => [
        new Date(a.created_at).toLocaleString(),
        a.worker_name,
        a.worker_dni,
        a.tag_uid,
        a.cold_room_name,
        a.alert_type,
        severityBadge(a.severity),
        a.message,
        a.status === 'active' ? '<span class="badge warn">activa</span>' : '<span class="badge ok">archivada</span>',
        a.acknowledged_by || '-',
        a.status === 'active' ? `<button onclick="archiveAlert('${a.id}')">Archivar</button>` : '-'
      ])
    )}
  `;
}

async function renderAlarms() {
  const rules = await api('/alarm-rules');
  q('alarms').innerHTML = `
    <h2>Gestión de alarmas</h2>
    <div class="grid three">
      <input id="aDesc" placeholder="Descripción" />
      <input id="aBuzz" type="number" min="1" placeholder="Minutos buzzer/shaker" />
      <input id="aAlarm" type="number" min="1" placeholder="Minutos alarma" />
      <input id="aGrace" type="number" min="1" placeholder="Min gracia fuera cámara" value="15" />
    </div>
    <button class="mt-12" onclick="createAlarmRule()">Crear alarma</button>
    ${table(['Descripción', 'Min buzzer/shaker', 'Min alarma', 'Min gracia fuera', 'Configuración', 'Estado operativo', 'Acciones'], rules.map((r) => {
      const editing = inlineEdit.alarmRules.id === r.id;
      if (!editing) return [r.description, r.buzzer_shaker_minutes, r.alarm_minutes, (r.alarm_visibility_grace_minutes == null ? 15 : r.alarm_visibility_grace_minutes), r.active ? 'encendida' : 'apagada', r.operational_status || (r.active ? 'encendida' : 'apagada'), `<button onclick="beginAlarmRuleInlineEdit('${r.id}')">Editar</button> <button onclick="toggleAlarm('${r.id}', ${!r.active})">${r.active ? 'Apagar' : 'Encender'}</button> <button class='danger' onclick="deleteAlarm('${r.id}')">Eliminar</button>`];
      const d = inlineEdit.alarmRules.draft;
      return [
        `<input value="${esc(d.descripcion)}" oninput="updateInlineEdit('alarmRules','descripcion',this.value)"/>`,
        `<input type="number" min="1" value="${esc(d.minutosBuzzerShaker)}" oninput="updateInlineEdit('alarmRules','minutosBuzzerShaker',this.value)"/>`,
        `<input type="number" min="1" value="${esc(d.minutosAlarma)}" oninput="updateInlineEdit('alarmRules','minutosAlarma',this.value)"/>`,
        `<input type="number" min="1" value="${esc(d.minutosGraciaFuera)}" oninput="updateInlineEdit('alarmRules','minutosGraciaFuera',this.value)"/>`,
        `<select onchange="updateInlineEdit('alarmRules','active',this.value==='true')"><option value="true" ${d.active ? 'selected' : ''}>encendida</option><option value="false" ${!d.active ? 'selected' : ''}>apagada</option></select>`,
        r.operational_status || (r.active ? 'encendida' : 'apagada'),
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
  if (![minutosBuzzerShaker, minutosAlarma, minutosGraciaFuera].every((v) => Number.isFinite(v) && v > 0)) {
    return alert('Valores numéricos inválidos');
  }
  await api(`/alarm-rules/${id}`, { method: 'PATCH', body: JSON.stringify({ descripcion: d.descripcion, minutosBuzzerShaker, minutosAlarma, minutosGraciaFuera, active: d.active }) });
  cancelInlineEdit('alarmRules');
  renderAlarms();
}

async function createAlarmRule() {

  await api('/alarm-rules', {
    method: 'POST',
    body: JSON.stringify({
      descripcion: q('aDesc').value,
      minutosBuzzerShaker: Number(q('aBuzz').value),
      minutosAlarma: Number(q('aAlarm').value),
      minutosGraciaFuera: Number(q('aGrace').value || 15)
    })
  });
  renderAlarms();
}

async function toggleAlarm(id, active) { await api(`/alarm-rules/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }); renderAlarms(); }
async function deleteAlarm(id) { if (!confirm('¿Eliminar alarma?')) return; try { await api(`/alarm-rules/${id}`, { method: 'DELETE' }); renderAlarms(); } catch (error) { alert(apiErrorMessage(error)); } }

async function renderReports() {
  q('reports').innerHTML = `
    <h2>Informes de inspección</h2>
    <p>PDF y Excel contienen el mismo dataset operativo.</p>
    <div class="actions">
      <button onclick="downloadReport('/reports/inspection.pdf','inspection.pdf')">Descargar PDF</button>
      <button class="secondary" onclick="downloadReport('/reports/inspection.xlsx','inspection.xlsx')">Descargar Excel</button>
    </div>
  `;
}

async function downloadReport(url, filename) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('No se pudo descargar el informe');
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

function startRealtime() {
  if (realtimeSource) realtimeSource.close();
  realtimeSource = new EventSource(`/realtime/stream?access_token=${encodeURIComponent(token)}`);
  realtimeSource.addEventListener('snapshot', (event) => {
    const payload = JSON.parse(event.data);
    setSessionText(`· dentro: ${payload.totals.workersInside} · alertas: ${payload.totals.activeAlerts}`);
    if (!q('dashboard').hidden) renderDashboard(payload);
  });
}

(function wireLoginForm() {
  const form = q('loginForm');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await login();
    });
  }
})();

(async function bootstrap() {
  const resetToken = new URLSearchParams(window.location.search).get('reset_token');
  if (resetToken) {
    q('rpToken').value = resetToken;
  }

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
