(() => {
  const statusBadge = document.getElementById('account-status');
  const accountError = document.getElementById('account-error');
  const accountForm = document.getElementById('account-form');
  const usernameInput = document.getElementById('cuenta-usuario');
  const passwordInput = document.getElementById('cuenta-password');
  const roleInput = document.getElementById('cuenta-rol');
  const activeInput = document.getElementById('cuenta-activa');
  const cuentasBody = document.getElementById('cuentas-body');
  const cuentasVacias = document.getElementById('cuentas-vacias');
  const recargarBtn = document.getElementById('recargar-cuentas');
  const sessionChip = document.getElementById('session-chip');

  const { ensureSession, fetchJson, withBasePath } = window.ElecnorAuth;
  let currentSession = null;

  const showStatus = (message, tone = 'neutral') => {
    statusBadge.textContent = message;
    statusBadge.className = `badge badge--${tone}`;
  };

  const showError = (message) => {
    accountError.textContent = message;
    accountError.hidden = false;
  };

  const clearError = () => {
    accountError.hidden = true;
    accountError.textContent = '';
  };

  const formatDate = (value) => new Date(value).toLocaleString();

  const renderUsers = (users) => {
    cuentasBody.innerHTML = '';
    if (!users.length) {
      cuentasVacias.classList.remove('hidden');
      return;
    }
    cuentasVacias.classList.add('hidden');

    users.forEach((user) => {
      const row = document.createElement('div');
      row.className = 'table__row';

      const userCell = document.createElement('span');
      userCell.className = 'table__cell strong';
      userCell.textContent = user.username;

      const roleCell = document.createElement('span');
      roleCell.className = 'table__cell';
      const roleBadge = document.createElement('span');
      roleBadge.className = `chip chip--${user.role === 'admin' ? 'accent' : 'muted'}`;
      roleBadge.textContent = user.role === 'admin' ? 'Administrador' : 'Usuario';
      roleCell.appendChild(roleBadge);

      const stateCell = document.createElement('span');
      stateCell.className = 'table__cell';
      const stateBadge = document.createElement('span');
      stateBadge.className = `chip chip--${user.active ? 'success' : 'danger'}`;
      stateBadge.textContent = user.active ? 'Activa' : 'Desactivada';
      stateCell.appendChild(stateBadge);

      const updatedCell = document.createElement('span');
      updatedCell.className = 'table__cell muted';
      updatedCell.textContent = formatDate(user.updatedAt || user.createdAt);

      const actionsCell = document.createElement('span');
      actionsCell.className = 'table__cell action-group';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'link';
      toggleBtn.textContent = user.active ? 'Desactivar' : 'Activar';
      toggleBtn.addEventListener('click', () => updateUser(user.username, { active: !user.active }));

      const roleBtn = document.createElement('button');
      roleBtn.type = 'button';
      roleBtn.className = 'link';
      roleBtn.textContent = user.role === 'admin' ? 'Pasar a usuario' : 'Pasar a admin';
      roleBtn.addEventListener('click', () => updateUser(user.username, { role: user.role === 'admin' ? 'user' : 'admin' }));

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'link';
      resetBtn.textContent = 'Cambiar contraseña';
      resetBtn.addEventListener('click', () => {
        const nueva = window.prompt(`Nueva contraseña para ${user.username}`);
        if (nueva && nueva.trim().length >= 4) {
          updateUser(user.username, { password: nueva.trim() });
        } else if (nueva) {
          alert('La contraseña debe tener al menos 4 caracteres.');
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'link link--danger';
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.disabled = currentSession?.username === user.username;
      deleteBtn.title = deleteBtn.disabled ? 'No puedes eliminar tu propia sesión' : 'Eliminar cuenta';
      deleteBtn.addEventListener('click', () => {
        if (confirm(`¿Eliminar la cuenta ${user.username}?`)) {
          deleteUser(user.username);
        }
      });

      actionsCell.append(toggleBtn, roleBtn, resetBtn, deleteBtn);
      row.append(userCell, roleCell, stateCell, updatedCell, actionsCell);
      cuentasBody.appendChild(row);
    });
  };

  const loadUsers = async () => {
    clearError();
    try {
      const { users } = await fetchJson(withBasePath('/api/auth/users'));
      renderUsers(users || []);
      showStatus('Datos sincronizados', 'neutral');
    } catch (error) {
      showError('No se pudieron cargar las cuentas');
    }
  };

  const createAccount = async (event) => {
    event.preventDefault();
    clearError();
    showStatus('Guardando...', 'info');

    try {
      await fetchJson(withBasePath('/api/auth/users'), {
        method: 'POST',
        body: JSON.stringify({
          username: usernameInput.value.trim(),
          password: passwordInput.value.trim(),
          role: roleInput.value,
          active: activeInput.checked
        })
      });
      showStatus('Cuenta creada', 'success');
      accountForm.reset();
      activeInput.checked = true;
      await loadUsers();
    } catch (error) {
      if (error.status === 409) {
        showError('El usuario ya existe o se quedaría sin administradores');
      } else if (error.status === 400) {
        showError('Revisa los datos introducidos');
      } else {
        showError('No se pudo crear la cuenta');
      }
      showStatus('Error al crear', 'danger');
    }
  };

  const updateUser = async (username, changes) => {
    clearError();
    showStatus('Actualizando...', 'info');
    try {
      await fetchJson(withBasePath(`/api/auth/users/${encodeURIComponent(username)}`), {
        method: 'PATCH',
        body: JSON.stringify(changes)
      });
      await loadUsers();
      showStatus('Actualizado', 'success');
    } catch (error) {
      if (error.status === 409) {
        showError('Debe existir al menos un administrador activo');
      } else if (error.status === 404) {
        showError('La cuenta ya no existe');
      } else {
        showError('No se pudo actualizar la cuenta');
      }
      showStatus('Cambios no aplicados', 'danger');
    }
  };

  const deleteUser = async (username) => {
    clearError();
    showStatus('Eliminando...', 'info');
    try {
      await fetchJson(withBasePath(`/api/auth/users/${encodeURIComponent(username)}`), {
        method: 'DELETE'
      });
      await loadUsers();
      showStatus('Cuenta eliminada', 'success');
    } catch (error) {
      if (error.status === 409) {
        showError('Debe quedar un administrador activo');
      } else {
        showError('No se pudo eliminar la cuenta');
      }
      showStatus('No eliminada', 'danger');
    }
  };

  const init = async () => {
    currentSession = await ensureSession(true);
    if (!currentSession) return;
    sessionChip.textContent = `${currentSession.username} · ${currentSession.role === 'admin' ? 'Admin' : 'Usuario'}`;
    await loadUsers();
  };

  recargarBtn.addEventListener('click', loadUsers);
  accountForm.addEventListener('submit', createAccount);

  init();
})();
