import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction } from './ui.js';

const { user: currentUser, isAdmin } = initAuthPage();
if (!currentUser) {
  throw new Error('Usuario no autenticado');
}

if (!isAdmin) {
  window.location.href = '/dashboard.html';
}

const createUserBtn = document.getElementById('createUserBtn');
const usersTableBody = document.querySelector('#usersTable tbody');
const usersEmpty = document.getElementById('usersEmpty');
const usersAlert = document.getElementById('usersAlert');

let users = [];

const dateFormatter = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'short',
  timeStyle: 'short'
});

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return dateFormatter.format(date);
};

const showAlert = (message, type = 'info') => {
  if (!usersAlert) return;
  usersAlert.textContent = message;
  usersAlert.className = `alert ${type}`;
  usersAlert.style.display = 'block';
};

const hideAlert = () => {
  if (!usersAlert) return;
  usersAlert.style.display = 'none';
};

const renderUsers = () => {
  if (!usersTableBody) {
    return;
  }

  usersTableBody.innerHTML = '';

  if (!users.length) {
    if (usersEmpty) {
      usersEmpty.style.display = 'block';
    }
    return;
  }

  if (usersEmpty) {
    usersEmpty.style.display = 'none';
  }

  users.forEach((item) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = item.display_name || '—';
    row.appendChild(nameCell);

    const emailCell = document.createElement('td');
    emailCell.textContent = item.email;
    row.appendChild(emailCell);

    const roleCell = document.createElement('td');
    const roleTag = document.createElement('span');
    roleTag.className = `tag ${item.role === 'ADMIN' ? 'tag-admin' : 'tag-user'}`;
    roleTag.textContent = item.role === 'ADMIN' ? 'Administrador' : 'Usuario';
    roleCell.appendChild(roleTag);
    row.appendChild(roleCell);

    const createdCell = document.createElement('td');
    createdCell.textContent = formatDate(item.created_at);
    row.appendChild(createdCell);

    const updatedCell = document.createElement('td');
    updatedCell.textContent = formatDate(item.updated_at);
    row.appendChild(updatedCell);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'table-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.dataset.action = 'edit';
    editButton.dataset.id = String(item.id);
    editButton.textContent = 'Editar';
    actionsCell.appendChild(editButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.dataset.action = 'delete';
    deleteButton.dataset.id = String(item.id);
    deleteButton.textContent = 'Eliminar';
    deleteButton.classList.add('secondary');
    if (currentUser.id === item.id) {
      deleteButton.disabled = true;
      deleteButton.title = 'No puedes eliminar tu propio usuario';
    }
    actionsCell.appendChild(deleteButton);

    row.appendChild(actionsCell);
    usersTableBody.appendChild(row);
  });
};

const loadUsers = async () => {
  try {
    users = await apiGet('/users');
    renderUsers();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron cargar los usuarios';
    showAlert(message, 'error');
  }
};

const openCreateUserModal = async () => {
  await openFormModal({
    title: 'Nuevo usuario',
    submitText: 'Crear usuario',
    fields: [
      { name: 'email', label: 'Correo electrónico', type: 'email', required: true },
      { name: 'name', label: 'Nombre para mostrar', type: 'text', placeholder: 'Opcional' },
      {
        name: 'role',
        label: 'Rol',
        type: 'select',
        required: true,
        options: [
          { label: 'Usuario', value: 'USER' },
          { label: 'Administrador', value: 'ADMIN' }
        ]
      },
      { name: 'password', label: 'Contraseña', type: 'password', required: true }
    ],
    initialValues: { role: 'USER' },
    onSubmit: async (values) => {
      const email = values.email ? String(values.email).trim() : '';
      const password = values.password ? String(values.password) : '';
      const name = values.name ? String(values.name).trim() : '';
      const selectedRole = values.role === 'ADMIN' ? 'ADMIN' : 'USER';

      if (!email || !password) {
        throw new Error('Email y contraseña son obligatorios');
      }

      await apiPost('/users', {
        email,
        password,
        name,
        role: selectedRole
      });
      await loadUsers();
      showAlert('Usuario creado correctamente', 'success');
    }
  });
};

const openEditUserModal = async (userToEdit) => {
  await openFormModal({
    title: `Editar ${userToEdit.email}`,
    submitText: 'Guardar cambios',
    fields: [
      { name: 'email', label: 'Correo electrónico', type: 'email', required: true },
      { name: 'name', label: 'Nombre para mostrar', type: 'text', placeholder: 'Opcional' },
      {
        name: 'role',
        label: 'Rol',
        type: 'select',
        required: true,
        options: [
          { label: 'Usuario', value: 'USER' },
          { label: 'Administrador', value: 'ADMIN' }
        ]
      },
      { name: 'password', label: 'Contraseña (dejar en blanco para mantenerla)', type: 'password' }
    ],
    initialValues: {
      email: userToEdit.email,
      name: userToEdit.display_name || '',
      role: userToEdit.role
    },
    onSubmit: async (values) => {
      const email = values.email ? String(values.email).trim() : '';
      const name = values.name ? String(values.name).trim() : '';
      const selectedRole = values.role === 'ADMIN' ? 'ADMIN' : 'USER';
      const password = values.password ? String(values.password) : undefined;

      if (!email) {
        throw new Error('El email es obligatorio');
      }

      const payload = {
        email,
        name,
        role: selectedRole
      };
      if (password) {
        payload.password = password;
      }

      await apiPut(`/users/${userToEdit.id}`, payload);
      await loadUsers();
      showAlert('Usuario actualizado correctamente', 'success');
    }
  });
};

const handleDeleteUser = async (userToDelete) => {
  const confirmed = await confirmAction({
    title: 'Eliminar usuario',
    message: `¿Seguro que quieres eliminar <strong>${userToDelete.email}</strong>?`,
    confirmText: 'Eliminar',
    cancelText: 'Cancelar'
  });
  if (!confirmed) {
    return;
  }

  try {
    await apiDelete(`/users/${userToDelete.id}`);
    await loadUsers();
    showAlert('Usuario eliminado correctamente', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo eliminar el usuario';
    showAlert(message, 'error');
  }
};

if (createUserBtn) {
  createUserBtn.addEventListener('click', () => {
    hideAlert();
    openCreateUserModal().catch((error) => {
      const message = error instanceof Error ? error.message : 'No se pudo crear el usuario';
      showAlert(message, 'error');
    });
  });
}

if (usersTableBody) {
  usersTableBody.addEventListener('click', (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest('button') : null;
    if (!target || !(target instanceof HTMLButtonElement)) {
      return;
    }
    if (target.disabled) {
      return;
    }

    const action = target.dataset.action;
    const id = Number.parseInt(target.dataset.id || '', 10);
    if (!action || !Number.isInteger(id) || id <= 0) {
      return;
    }

    const selectedUser = users.find((item) => item.id === id);
    if (!selectedUser) {
      return;
    }

    hideAlert();

    if (action === 'edit') {
      openEditUserModal(selectedUser).catch((error) => {
        const message = error instanceof Error ? error.message : 'No se pudo actualizar el usuario';
        showAlert(message, 'error');
      });
    } else if (action === 'delete') {
      handleDeleteUser(selectedUser).catch((error) => {
        const message = error instanceof Error ? error.message : 'No se pudo eliminar el usuario';
        showAlert(message, 'error');
      });
    }
  });
}

hideAlert();
loadUsers();
