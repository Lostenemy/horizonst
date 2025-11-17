(() => {
  const { ensureSession } = window.ElecnorAuth;
  const form = document.getElementById('user-form');
  const resetButton = document.getElementById('reset-form');
  const statusChip = document.getElementById('form-status');
  const filterInput = document.getElementById('filter');
  const centerFilter = document.getElementById('center-filter');
  const usersBody = document.getElementById('users-body');

  let editingDni = null;

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
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No hay usuarios que coincidan con el filtro.';
      usersBody.appendChild(empty);
      return;
    }

    users.forEach((user) => {
      const row = document.createElement('div');
      row.className = 'table__row';

      const cells = [
        user.dni,
        `${user.nombre} ${user.apellidos}`,
        `${user.empresa} (${user.cif})`,
        user.centro
      ];

      cells.forEach((cell) => {
        const span = document.createElement('span');
        span.className = 'table__cell';
        span.textContent = cell;
        row.appendChild(span);
      });

      const status = document.createElement('span');
      status.className = `table__cell status status--${user.activo ? 'ok' : 'off'}`;
      status.textContent = user.activo ? 'Activo' : 'Desactivado';
      row.appendChild(status);

      const actions = document.createElement('div');
      actions.className = 'table__cell table__actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'cta cta--ghost';
      editBtn.type = 'button';
      editBtn.textContent = 'Editar';
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
        setStatus(`Editando ${user.dni}`, 'info');
        form.dni.focus();
      });

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'cta cta--secondary';
      toggleBtn.type = 'button';
      toggleBtn.textContent = user.activo ? 'Desactivar' : 'Activar';
      toggleBtn.addEventListener('click', () => {
        window.ElecnorData.upsertUser({ ...user, activo: !user.activo });
        renderUsers();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'cta cta--danger';
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.addEventListener('click', () => {
        if (confirm(`¿Eliminar al usuario ${user.nombre}?`)) {
          window.ElecnorData.deleteUser(user.dni);
          renderUsers();
          fillCenterOptions();
        }
      });

      actions.append(editBtn, toggleBtn, deleteBtn);
      row.appendChild(actions);
      usersBody.appendChild(row);
    });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();

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

    if (!payload.dni || !payload.nombre || !payload.apellidos || !payload.empresa || !payload.cif || !payload.centro) {
      setStatus('Completa los campos obligatorios marcados con *', 'alert');
      return;
    }

    window.ElecnorData.upsertUser(payload);
    setStatus(`Usuario ${payload.dni} guardado correctamente`, 'ok');
    editingDni = null;
    renderUsers();
    fillCenterOptions();
    form.reset();
    form.activo.checked = true;
  });

  resetButton.addEventListener('click', () => {
    form.reset();
    form.activo.checked = true;
    editingDni = null;
    setStatus('Formulario limpio', 'muted');
  });

  filterInput.addEventListener('input', renderUsers);
  centerFilter.addEventListener('change', renderUsers);

  const init = async () => {
    const session = await ensureSession();
    if (!session) return;
    fillCenterOptions();
    renderUsers();
  };

  init();
})();
