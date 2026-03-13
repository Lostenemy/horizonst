let token = localStorage.getItem('cc_token') || '';
let currentUser = null;
let realtimeSource = null;

const q = (id) => document.getElementById(id);
const sections = ['dashboard', 'users', 'inventory', 'assignments', 'alarms', 'reports'];

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
  if (state === 'alarma') return '<span class="badge alert">alarma</span>';
  if (state === 'dentro') return '<span class="badge warn">dentro</span>';
  return '<span class="badge ok">fuera</span>';
}

function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
    rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="99">Sin datos</td></tr>'
  }</tbody></table>`;
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
  const alarmRuleRows = (data.activeAlarmRules || []).map((r) => [r.description, r.buzzer_shaker_minutes, r.alarm_minutes]);

  q('dashboard').innerHTML = `
    <h2>Dashboard operativo</h2>
    <div class="metrics">
      <div class="metric"><small>Trabajadores detectados dentro</small><b>${data.totals.workersInside}</b></div>
      <div class="metric"><small>Incidencias activas (disparadas)</small><b>${data.totals.activeAlerts}</b></div>
      <div class="metric"><small>Reglas de alarma activas</small><b>${data.totals.activeAlarmRules ?? 0}</b></div>
      <div class="metric"><small>Última actualización</small><b style="font-size:14px">${new Date(data.ts).toLocaleTimeString()}</b></div>
    </div>
    <p class="muted">Nota: “Incidencias activas” muestra alertas disparadas sin reconocer. “Reglas de alarma activas” muestra configuración habilitada.</p>
    <h3>Trabajadores dentro (presencia real)</h3>
    ${table(['Trabajador', 'DNI', 'Tag', 'Min dentro', 'Estado'], workersRows)}
    <h3 class="mt-12">Incidencias activas (disparadas)</h3>
    ${table(['Tipo', 'Severidad', 'Mensaje', 'Fecha'], alertsRows)}
    <h3 class="mt-12">Reglas de alarma activas (configuración)</h3>
    ${table(['Descripción', 'Min buzzer/shaker', 'Min alarma'], alarmRuleRows)}
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
    ${table(['Nombre', 'Email', 'Rol', 'Estado', 'Turno', 'Acciones'], users.map((u) => [
      `${u.first_name} ${u.last_name}`,
      u.email,
      u.role,
      u.status,
      u.shift || '-',
      `<button onclick="deactivateUser('${u.id}')">Desactivar</button>${roleCan('superadministrador') ? ` <button class='danger' onclick="deleteUser('${u.id}')">Borrar</button>` : ''}`
    ]))}
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
    ${table(['MAC', 'Descripción', 'Activo'], tags.map((t) => [t.tag_uid, t.model || '', t.active ? 'sí' : 'no']))}
    <h3 class="mt-12">Gateways</h3>
    ${table(['MAC', 'Descripción'], gateways.map((g) => [g.gateway_mac, g.description || '']))}
  `;
}

async function createTag() { await api('/tags', { method: 'POST', body: JSON.stringify({ mac: q('tagMac').value, descripcion: q('tagDesc').value }) }); renderInventory(); }
async function createGateway() { await api('/gateways', { method: 'POST', body: JSON.stringify({ mac: q('gwMac').value, descripcion: q('gwDesc').value }) }); renderInventory(); }

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
    ${table(['Nombre', 'DNI', 'Activo'], workers.map((w) => [w.full_name, w.dni, w.active ? 'sí' : 'no']))}

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

async function renderAlarms() {
  const rules = await api('/alarm-rules');
  q('alarms').innerHTML = `
    <h2>Gestión de alarmas</h2>
    <div class="grid three">
      <input id="aDesc" placeholder="Descripción" />
      <input id="aBuzz" type="number" min="1" placeholder="Minutos buzzer/shaker" />
      <input id="aAlarm" type="number" min="1" placeholder="Minutos alarma" />
    </div>
    <button class="mt-12" onclick="createAlarmRule()">Crear alarma</button>
    ${table(['Descripción', 'Min buzzer/shaker', 'Min alarma', 'Estado', 'Acciones'], rules.map((r) => [
      r.description,
      r.buzzer_shaker_minutes,
      r.alarm_minutes,
      r.active ? 'activa' : 'desactiva',
      `<button onclick="toggleAlarm('${r.id}', ${!r.active})">${r.active ? 'Desactivar' : 'Activar'}</button> <button class='danger' onclick="deleteAlarm('${r.id}')">Eliminar</button>`
    ]))}
  `;
}

async function createAlarmRule() {
  await api('/alarm-rules', {
    method: 'POST',
    body: JSON.stringify({
      descripcion: q('aDesc').value,
      minutosBuzzerShaker: Number(q('aBuzz').value),
      minutosAlarma: Number(q('aAlarm').value)
    })
  });
  renderAlarms();
}

async function toggleAlarm(id, active) { await api(`/alarm-rules/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }); renderAlarms(); }
async function deleteAlarm(id) { if (confirm('¿Eliminar alarma?')) { await api(`/alarm-rules/${id}`, { method: 'DELETE' }); renderAlarms(); } }

async function renderReports() {
  q('reports').innerHTML = `
    <h2>Informes de inspección</h2>
    <p>PDF y Excel contienen el mismo dataset operativo.</p>
    <button onclick="downloadReport('/reports/inspection.pdf','inspection.pdf')">Descargar PDF</button>
    <button class="secondary" onclick="downloadReport('/reports/inspection.xlsx','inspection.xlsx')">Descargar Excel</button>
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
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await login();
  });
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
