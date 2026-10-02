import { apiGet,apiPost,apiPatch,apiDelete } from './api.js';
import { initAuthPage,openFormModal } from './ui.js';
import { createLoadState } from './load-state.js';
const { user,isAdmin } = initAuthPage();
if (!user) throw new Error('Usuario no autenticado');
const body = document.querySelector('#typesTable tbody'), feedback = document.getElementById('typeFeedback');
const create = document.getElementById('createType'); create.hidden = !isAdmin;
let loading = false;
const state = createLoadState({ anchor: body.closest('table'), label: 'catálogo de tipos', empty: document.getElementById('typesEmpty'), clear: () => body.replaceChildren(), onRetry: () => load() });
const fields = [{ name:'name',label:'Nombre',required:true },{ name:'description',label:'Descripción',type:'textarea' }];
const action = (label, fn) => { const b=document.createElement('button'); b.type='button'; b.textContent=label; b.addEventListener('click',async () => { try { await fn(); } catch { feedback.textContent='No se pudo guardar el cambio. Reintenta.'; } }); return b; };
async function load() {
  if (loading) return; loading=true; state('loading');
  try {
    const types = await apiGet('/device-types'); body.replaceChildren();
    for (const type of types) {
      const row=document.createElement('tr');
      for (const value of [type.code,type.name,type.description,type.active ? 'Activo' : 'Inactivo',type.code==='b5' ? 'Compatible' : 'No soportado']) { const cell=document.createElement('td'); cell.textContent=value; row.appendChild(cell); }
      const cell=document.createElement('td');
      if (isAdmin) {
        cell.appendChild(action('Editar', () => openFormModal({ title:`Editar ${type.code} (código inmutable)`, fields, initialValues:type, onSubmit: async values => { await apiPatch(`/device-types/${type.code}`,values); await load(); } })));
        cell.appendChild(action(type.active?'Desactivar':'Reactivar',async () => { if (type.active) await apiDelete(`/device-types/${type.code}`); else await apiPatch(`/device-types/${type.code}`,{active:true}); await load(); }));
      }
      row.appendChild(cell); body.appendChild(row);
    }
    state(types.length?'ready':'empty');
  } catch (error) { state(error.status===403?'denied':'error',error); }
  finally { loading=false; }
}
create.addEventListener('click', () => openFormModal({ title:'Crear tipo', fields:[{name:'code',label:'Código técnico estable (minúsculas, máximo 32)',required:true},...fields], onSubmit: async values => { await apiPost('/device-types',values); await load(); } }));
void load();
