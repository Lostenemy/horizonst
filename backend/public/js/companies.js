import { apiDelete, apiGet, apiPatch, apiPost } from './api.js';
import { confirmAction, initAuthPage, openFormModal } from './ui.js';

const { user, isAdmin } = initAuthPage();
if (!user) throw new Error('Usuario no autenticado');
const tableBody = document.querySelector('#companiesTable tbody');
const feedback = document.getElementById('companyFeedback');
const createButton = document.getElementById('createCompany');
createButton.hidden = !isAdmin;

const validate = ({ code, name }) => {
  const normalizedCode = String(code || '').trim().toLowerCase();
  const normalizedName = String(name || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalizedCode) || !normalizedName || normalizedName.length > 160) {
    throw new Error('Código o nombre no válido (máximo 64 y 160 caracteres).');
  }
  return { code: normalizedCode, name: normalizedName };
};

const actionButton = (label, callback) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', callback);
  return button;
};

const showError = (error) => { feedback.textContent = error.message || String(error); };

const loadCompanies = async () => {
  const companies = await apiGet('/companies');
  tableBody.replaceChildren();
  for (const company of companies) {
    const row = document.createElement('tr');
    for (const value of [company.code, company.name, company.active ? 'Activa' : 'Inactiva']) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    }
    const actions = document.createElement('td');
    actions.appendChild(actionButton('Consultar', () => {
      feedback.textContent = `${company.code} · ${company.name} · ${company.active ? 'Activa' : 'Inactiva'}`;
    }));
    if (isAdmin) {
      actions.appendChild(actionButton('Editar', () => {
        void openFormModal({
          title: `Editar ${company.code}`,
          fields: [
            { name: 'code', label: 'Código', type: 'text', required: true },
            { name: 'name', label: 'Nombre', type: 'text', required: true }
          ],
          initialValues: company,
          onSubmit: async (values) => {
            await apiPatch(`/companies/${company.id}`, validate(values));
            feedback.textContent = 'Compañía actualizada.';
            await loadCompanies();
          }
        });
      }));
      actions.appendChild(actionButton(company.active ? 'Desactivar' : 'Reactivar', async () => {
        if (!await confirmAction({
          title: company.active ? 'Desactivar compañía' : 'Reactivar compañía',
          message: `¿Confirmas el cambio de estado de ${company.code}? Su historial se conserva. Al desactivar, los usuarios limitados a esta compañía dejarán de verla y operar sus gateways.`,
          confirmText: company.active ? 'Desactivar' : 'Reactivar'
        })) return;
        try {
          if (company.active) await apiDelete(`/companies/${company.id}`);
          else await apiPatch(`/companies/${company.id}`, { active: true });
          feedback.textContent = 'Estado actualizado.';
          await loadCompanies();
        } catch (error) { showError(error); }
      }));
    }
    row.appendChild(actions);
    tableBody.appendChild(row);
  }
};

createButton.addEventListener('click', () => {
  void openFormModal({
    title: 'Crear compañía', submitText: 'Crear',
    fields: [
      { name: 'code', label: 'Código', type: 'text', required: true },
      { name: 'name', label: 'Nombre', type: 'text', required: true }
    ],
    onSubmit: async (values) => {
      await apiPost('/companies', validate(values));
      feedback.textContent = 'Compañía creada.';
      await loadCompanies();
    }
  });
});

loadCompanies().catch(showError);
