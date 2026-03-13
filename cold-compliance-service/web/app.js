let token = localStorage.getItem('cc_token') || '';
const api = async (url, options={}) => {
  const res = await fetch(url, { ...options, headers: { 'Content-Type':'application/json', ...(options.headers||{}), ...(token?{Authorization:`Bearer ${token}`}:{}) }});
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
};
async function login(){const username=v('username'),password=v('password');const data=await api('/auth/login',{method:'POST',body:JSON.stringify({username,password})});token=data.token;localStorage.setItem('cc_token',token);document.getElementById('login').hidden=true;document.getElementById('app').hidden=false;document.getElementById('session').textContent=`${data.user.first_name} (${data.user.role})`;startRealtime();loadDashboard();}
async function forgot(){await api('/auth/forgot-password',{method:'POST',body:JSON.stringify({email:v('fpEmail')})});alert('Si el email existe, se ha enviado la recuperación.');}
async function resetPass(){await api('/auth/reset-password',{method:'POST',body:JSON.stringify({token:v('rpToken'),newPassword:v('rpPass')})});alert('Contraseña actualizada');}
const v=(id)=>document.getElementById(id).value;
const set=(html)=>document.getElementById('content').innerHTML=html;
async function loadDashboard(){const [presence,alerts]=await Promise.all([api('/dashboard/presence'),api('/dashboard/alerts')]);set(`<h3>Trabajadores dentro (${presence.length})</h3>${tbl(['Trabajador','DNI','Tag','Minutos'],presence.map(r=>[r.full_name,r.dni,r.tag_uid||'',Math.floor(r.elapsed_seconds/60)]))}<h3>Alertas activas (${alerts.length})</h3>${tbl(['Tipo','Mensaje','Fecha'],alerts.map(a=>[a.alert_type,a.message,a.created_at]))}`)}
async function loadUsers(){const rows=await api('/users');set(`<h3>Usuarios</h3>${tbl(['Nombre','Email','Rol','Estado'],rows.map(r=>[`${r.first_name} ${r.last_name}`,r.email,r.role,r.status]))}`)}
async function loadTagsGateways(){const [tags,gateways]=await Promise.all([api('/tags'),api('/gateways')]);set(`<h3>Tags</h3>${tbl(['MAC','Descripción','Activo'],tags.map(t=>[t.tag_uid,t.model||'',t.active]))}<h3>Gateways</h3>${tbl(['MAC','Descripción'],gateways.map(g=>[g.gateway_mac,g.description||'']))}`)}
async function loadAssignments(){const rows=await api('/workers/assignments/history');set(`<h3>Histórico de asignaciones</h3>${tbl(['Trabajador','Tag','Inicio','Fin'],rows.map(r=>[r.worker_name,r.tag_mac,r.assigned_at,r.unassigned_at||'']))}`)}
async function loadAlarms(){const rows=await api('/alarm-rules');set(`<h3>Alarmas</h3>${tbl(['Descripción','Min buzzer/shaker','Min alarma','Estado'],rows.map(r=>[r.description,r.buzzer_shaker_minutes,r.alarm_minutes,r.active?'activa':'desactiva']))}`)}
async function loadReports(){set(`<h3>Informes inspección</h3><a href="/reports/inspection.pdf" target="_blank">Descargar PDF</a><br><a href="/reports/inspection.xlsx" target="_blank">Descargar Excel</a>`)}
const tbl=(h,r)=>`<table><tr>${h.map(x=>`<th>${x}</th>`).join('')}</tr>${r.map(a=>`<tr>${a.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join('')}</table>`;
function startRealtime(){const es=new EventSource('/realtime/stream',{withCredentials:false});es.onmessage=(e)=>{const d=JSON.parse(e.data);document.getElementById('session').dataset.rt=`Activos:${d.activeWorkers} Alertas:${d.activeAlerts}`;};}
(async()=>{if(!token)return;try{const me=await api('/auth/me');document.getElementById('login').hidden=true;document.getElementById('app').hidden=false;document.getElementById('session').textContent=`${me.email} (${me.role})`;startRealtime();loadDashboard();}catch{localStorage.removeItem('cc_token');token='';}})();
