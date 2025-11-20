(() => {
  const statusBadge = document.getElementById('account-status');
  const modalStatusBadge = document.getElementById('account-modal-status');
  const accountError = document.getElementById('account-error');
  const accountModalError = document.getElementById('account-modal-error');
  const accountForm = document.getElementById('account-form');
  const usernameInput = document.getElementById('cuenta-usuario');
  const passwordInput = document.getElementById('cuenta-password');
  const roleInput = document.getElementById('cuenta-rol');
  const activeInput = document.getElementById('cuenta-activa');
  const cuentasBody = document.getElementById('cuentas-body');
  const cuentasVacias = document.getElementById('cuentas-vacias');
  const recargarBtn = document.getElementById('recargar-cuentas');
  const sessionChip = document.getElementById('session-chip');
  const accountModal = document.getElementById('account-modal');
  const openAccountModalBtn = document.getElementById('open-account-modal');
  const modalClosers = accountModal ? accountModal.querySelectorAll('[data-modal-close]') : [];

  const { ensureSession, fetchJson, withBasePath, rewriteNavLinks } = window.ElecnorAuth;
  const { showToast, confirmAction, clearFieldErrors, showFieldError } = window.ElecnorUI;
  let currentSession = null;

  const showStatus = (message, tone = 'neutral') => {
    [statusBadge, modalStatusBadge].forEach((element) => {
      if (!element) return;
      element.textContent = message;
      element.className = `badge badge--${tone}`;
      element.hidden = !message;
    });
  };

  const showError = (message) => {
    [accountError, accountModalError].forEach((element) => {
      if (!element) return;
      element.textContent = message;
      element.hidden = false;
    });
  };

  const clearError = () => {
    [accountError, accountModalError].forEach((element) => {
      if (!element) return;
      element.hidden = true;
      element.textContent = '';
    });
  };

  const formatDate = (value) => new Date(value).toLocaleString();

  const renderUsers = (users) => {
    cuentasBody.innerHTML = '';
    if (!users.length) {
      cuentasVacias.classList.remove('hidden');
      const emptyRow = document.createElement('tr');
      emptyRow.className = 'table__row table__row--empty';
      const emptyCell = document.createElement('td');
      emptyCell.className = 'table__cell';
      emptyCell.colSpan = 5;
      emptyCell.textContent = 'No hay cuentas adicionales registradas.';
      emptyRow.appendChild(emptyCell);
      cuentasBody.appendChild(emptyRow);
      return;
    }
    cuentasVacias.classList.add('hidden');

    users.forEach((user) => {
      const row = document.createElement('tr');
      row.className = 'table__row';

      const userCell = document.createElement('td');
      userCell.className = 'table__cell strong';
      userCell.textContent = user.username;

      const roleCell = document.createElement('td');
      roleCell.className = 'table__cell';
      const roleBadge = document.createElement('span');
      roleBadge.className = `chip chip--${user.role === 'admin' ? 'accent' : 'muted'}`;
      roleBadge.textContent = user.role === 'admin' ? 'Administrador' : 'Usuario';
      roleCell.appendChild(roleBadge);

      const stateCell = document.createElement('td');
      stateCell.className = 'table__cell';
      const stateBadge = document.createElement('span');
      stateBadge.className = `chip chip--${user.active ? 'success' : 'danger'}`;
      stateBadge.textContent = user.active ? 'Activa' : 'Desactivada';
      stateCell.appendChild(stateBadge);

      const updatedCell = document.createElement('td');
      updatedCell.className = 'table__cell muted';
      updatedCell.textContent = formatDate(user.updatedAt || user.createdAt);

      const actionsCell = document.createElement('td');
      actionsCell.className = 'table__cell table__actions';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'cta cta--secondary';
      toggleBtn.textContent = user.active ? 'Desactivar' : 'Activar';
      toggleBtn.setAttribute(
        'aria-label',
        `${user.active ? 'Desactivar' : 'Activar'} cuenta ${user.username}`
      );
      toggleBtn.addEventListener('click', () => updateUser(user.username, { active: !user.active }));

      const roleBtn = document.createElement('button');
      roleBtn.type = 'button';
      roleBtn.className = 'cta cta--ghost';
      roleBtn.textContent = user.role === 'admin' ? 'Pasar a usuario' : 'Pasar a admin';
      roleBtn.setAttribute('aria-label', `Cambiar rol de ${user.username}`);
      roleBtn.addEventListener('click', () => updateUser(user.username, { role: user.role === 'admin' ? 'user' : 'admin' }));

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'cta cta--ghost';
      resetBtn.textContent = 'Cambiar contraseña';
      resetBtn.setAttribute('aria-label', `Cambiar contraseña de ${user.username}`);
      resetBtn.addEventListener('click', () => {
        const nueva = window.prompt(`Nueva contraseña para ${user.username}`);
        if (nueva && nueva.trim().length >= 4) {
          updateUser(user.username, { password: nueva.trim() });
        } else if (nueva) {
          showToast('La contraseña debe tener al menos 4 caracteres.', 'error');
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'cta cta--danger';
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.disabled = currentSession?.username === user.username;
      deleteBtn.title = deleteBtn.disabled ? 'No puedes eliminar tu propia sesión' : 'Eliminar cuenta';
      deleteBtn.setAttribute('aria-label', `Eliminar cuenta ${user.username}`);
      deleteBtn.addEventListener('click', async () => {
        if (deleteBtn.disabled) return;
        const confirmed = await confirmAction({
          title: '¿Eliminar cuenta?',
          message: `¿Seguro que deseas eliminar la cuenta ${user.username}? Esta acción es irreversible.`,
          confirmLabel: 'Eliminar cuenta'
        });
        if (!confirmed) return;
        deleteUser(user.username);
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
    clearFieldErrors(accountForm);
    showStatus('Guardando...', 'info');

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const role = roleInput.value;
    let isValid = true;
    if (username.length < 3) {
      showFieldError(usernameInput, 'El usuario debe tener al menos 3 caracteres');
      isValid = false;
    }
    if (password.length < 4) {
      showFieldError(passwordInput, 'La contraseña debe tener al menos 4 caracteres');
      isValid = false;
    }
    if (!role) {
      showFieldError(roleInput, 'Selecciona un rol');
      isValid = false;
    }
    if (!isValid) {
      showStatus('Corrige los errores del formulario', 'danger');
      return;
    }

    try {
      await fetchJson(withBasePath('/api/auth/users'), {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          role,
          active: activeInput.checked
        })
      });
      showStatus('Cuenta creada', 'success');
      accountForm.reset();
      activeInput.checked = true;
      clearFieldErrors(accountForm);
      showToast(`Cuenta ${username} creada correctamente`, 'success');
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
      showToast(`Cuenta ${username} actualizada`, 'success');
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
      showToast(`Cuenta ${username} eliminada`, 'success');
    } catch (error) {
      if (error.status === 409) {
        showError('Debe quedar un administrador activo');
      } else {
        showError('No se pudo eliminar la cuenta');
      }
      showStatus('No eliminada', 'danger');
    }
  };

  const setModalOpen = (open) => {
    if (!accountModal) return;
    accountModal.classList.toggle('modal--open', open);
    accountModal.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('modal-open', open);
    if (open) {
      requestAnimationFrame(() => usernameInput?.focus());
    }
  };

  const init = async () => {
    rewriteNavLinks();
    currentSession = await ensureSession(true);
    if (!currentSession) return;
    sessionChip.textContent = `${currentSession.username} · ${currentSession.role === 'admin' ? 'Admin' : 'Usuario'}`;
    await loadUsers();
  };

  recargarBtn.addEventListener('click', loadUsers);
  accountForm.addEventListener('submit', createAccount);
  openAccountModalBtn?.addEventListener('click', () => {
    accountForm.reset();
    activeInput.checked = true;
    clearFieldErrors(accountForm);
    clearError();
    setModalOpen(true);
  });
  modalClosers.forEach((element) => {
    element.addEventListener('click', () => setModalOpen(false));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && accountModal?.classList.contains('modal--open')) {
      setModalOpen(false);
    }
  });

  init();
})();
