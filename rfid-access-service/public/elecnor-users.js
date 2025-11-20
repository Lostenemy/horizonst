(() => {
  const { ensureSession, rewriteNavLinks, applyNavAccess } = window.ElecnorAuth;
  const { showToast, debounce, confirmAction, clearFieldErrors, showFieldError } = window.ElecnorUI;
  const form = document.getElementById('user-form');
  const resetButton = document.getElementById('reset-form');
  const statusChip = document.getElementById('form-status');
  const filterInput = document.getElementById('filter');
  const centerFilter = document.getElementById('center-filter');
  const usersBody = document.getElementById('users-body');
  const openModalButton = document.getElementById('open-user-modal');
  const userModal = document.getElementById('user-modal');
  const modalClosers = userModal ? userModal.querySelectorAll('[data-modal-close]') : [];

  let editingDni = null;

  const setModalOpen = (open) => {
    if (!userModal) return;
    userModal.classList.toggle('modal--open', open);
    userModal.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('modal-open', open);
    if (open) {
      requestAnimationFrame(() => form?.dni.focus());
    }
  };

  const normalize = (value) => value.trim();

  const setStatus = (message, tone = 'muted') => {
    statusChip.textContent = message;
    statusChip.className = `badge badge--${tone}`;
  };

  const fillCenterOptions = () => {
    const centers = Array.from(new Set(window.ElecnorData.getUsers().map((u) => u.centro))).sort();
    centerFilter.innerHTML = '<option value="">Todos los centros</option>';
    centers.forEach((center) => {
      const option = document.createElement('option');
      option.value = center;
      option.textContent = center;
      centerFilter.appendChild(option);
    });
  };

  const renderUsers = () => {
    const term = normalize(filterInput.value).toLowerCase();
    const center = normalize(centerFilter.value).toLowerCase();

    const users = window.ElecnorData.getUsers()
      .filter((user) => {
        const matchesTerm =
          !term ||
          user.dni.toLowerCase().includes(term) ||
          user.nombre.toLowerCase().includes(term) ||
          user.apellidos.toLowerCase().includes(term) ||
          user.centro.toLowerCase().includes(term);

        const matchesCenter = !center || user.centro.toLowerCase() === center;
        return matchesTerm && matchesCenter;
      })
      .sort((a, b) => a.apellidos.localeCompare(b.apellidos, 'es'));

    usersBody.innerHTML = '';

    if (!users.length) {
      const emptyRow = document.createElement('tr');
      emptyRow.className = 'table__row table__row--empty';
      const emptyCell = document.createElement('td');
      emptyCell.className = 'table__cell';
      emptyCell.colSpan = 6;
      emptyCell.textContent = 'No hay usuarios que coincidan con el filtro.';
      emptyRow.appendChild(emptyCell);
      usersBody.appendChild(emptyRow);
      return;
    }

    users.forEach((user) => {
      const row = document.createElement('tr');
      row.className = 'table__row';

      const cells = [
        user.dni,
        `${user.nombre} ${user.apellidos}`,
        `${user.empresa} (${user.cif})`,
        user.centro
      ];

      cells.forEach((cellValue) => {
        const cell = document.createElement('td');
        cell.className = 'table__cell';
        cell.textContent = cellValue;
        row.appendChild(cell);
      });

      const statusCell = document.createElement('td');
      statusCell.className = 'table__cell';
      const chip = document.createElement('span');
      chip.className = `estado-chip ${user.activo ? 'estado-activa' : 'estado-bloqueada'}`;
      chip.textContent = user.activo ? 'Activo' : 'Desactivado';
      statusCell.appendChild(chip);
      row.appendChild(statusCell);

      const actions = document.createElement('td');
      actions.className = 'table__cell table__actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'cta cta--ghost';
      editBtn.type = 'button';
      editBtn.textContent = 'Editar';
      editBtn.setAttribute('aria-label', `Editar trabajador ${user.dni}`);
      editBtn.addEventListener('click', () => {
        editingDni = user.dni;
        form.dni.value = user.dni;
        form.nombre.value = user.nombre;
        form.apellidos.value = user.apellidos;
        form.empresa.value = user.empresa;
        form.cif.value = user.cif;
        form.centro.value = user.centro;
        form.email.value = user.email || '';
        form.activo.checked = Boolean(user.activo);
        clearFieldErrors(form);
        setStatus(`Editando ${user.dni}`, 'info');
        setModalOpen(true);
        form.dni.focus();
      });

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'cta cta--secondary';
      toggleBtn.type = 'button';
      toggleBtn.textContent = user.activo ? 'Desactivar' : 'Activar';
      toggleBtn.setAttribute(
        'aria-label',
        `${user.activo ? 'Desactivar' : 'Activar'} trabajador ${user.dni}`
      );
      toggleBtn.addEventListener('click', () => {
        window.ElecnorData.upsertUser({ ...user, activo: !user.activo });
        showToast(
          `Trabajador ${user.dni} ${user.activo ? 'desactivado' : 'activado'}`,
          'info'
        );
        renderUsers();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'cta cta--danger';
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.setAttribute('aria-label', `Eliminar trabajador ${user.dni}`);
      deleteBtn.addEventListener('click', async () => {
        const confirmed = await confirmAction({
          title: '¿Eliminar trabajador?',
          message: `¿Seguro que deseas eliminar a ${user.nombre}? Esta acción bloqueará sus tarjetas.`,
          confirmLabel: 'Eliminar trabajador'
        });
        if (!confirmed) return;
        window.ElecnorData.deleteUser(user.dni);
        showToast(`Trabajador ${user.dni} eliminado`, 'success');
        renderUsers();
        fillCenterOptions();
      });

      actions.append(editBtn, toggleBtn, deleteBtn);
      row.appendChild(actions);
      usersBody.appendChild(row);
    });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    clearFieldErrors(form);

    const payload = {
      dni: normalize(form.dni.value).toUpperCase(),
      nombre: normalize(form.nombre.value),
      apellidos: normalize(form.apellidos.value),
      empresa: normalize(form.empresa.value),
      cif: normalize(form.cif.value).toUpperCase(),
      centro: normalize(form.centro.value).toUpperCase(),
      email: normalize(form.email.value),
      activo: form.activo.checked
    };

    let isValid = true;
    if (!payload.dni) {
      showFieldError(form.dni, 'El DNI es obligatorio');
      isValid = false;
    }
    if (!payload.nombre) {
      showFieldError(form.nombre, 'El nombre es obligatorio');
      isValid = false;
    }
    if (!payload.apellidos) {
      showFieldError(form.apellidos, 'Los apellidos son obligatorios');
      isValid = false;
    }
    if (!payload.empresa) {
      showFieldError(form.empresa, 'La empresa es obligatoria');
      isValid = false;
    }
    if (!payload.cif) {
      showFieldError(form.cif, 'El CIF es obligatorio');
      isValid = false;
    }
    if (!payload.centro) {
      showFieldError(form.centro, 'El centro es obligatorio');
      isValid = false;
    }

    if (!isValid) {
      setStatus('Completa los campos obligatorios marcados con *', 'alert');
      return;
    }

    window.ElecnorData.upsertUser(payload);
    setStatus(`Usuario ${payload.dni} guardado correctamente`, 'ok');
    showToast(`✓ Usuario ${payload.dni} guardado correctamente`, 'success');
    editingDni = null;
    renderUsers();
    fillCenterOptions();
    form.reset();
    form.activo.checked = true;
    clearFieldErrors(form);
  });

  resetButton.addEventListener('click', () => {
    form.reset();
    form.activo.checked = true;
    editingDni = null;
    clearFieldErrors(form);
    setStatus('Formulario limpio', 'muted');
  });

  const debouncedFilter = debounce(renderUsers, 300);
  filterInput.addEventListener('input', debouncedFilter);
  centerFilter.addEventListener('change', renderUsers);

  openModalButton?.addEventListener('click', () => {
    editingDni = null;
    form.reset();
    form.activo.checked = true;
    clearFieldErrors(form);
    setStatus('Completa los datos del trabajador', 'muted');
    setModalOpen(true);
  });

  modalClosers.forEach((element) => {
    element.addEventListener('click', () => setModalOpen(false));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && userModal?.classList.contains('modal--open')) {
      setModalOpen(false);
    }
  });

  const init = async () => {
    rewriteNavLinks();
    const session = await ensureSession();
    if (!session) return;
    applyNavAccess(session);
    fillCenterOptions();
    renderUsers();
  };

  init();
})();
