(() => {
  const { ensureSession, rewriteNavLinks, applyNavAccess } = window.ElecnorAuth;
  const { showToast, debounce, confirmAction, clearFieldErrors, showFieldError } = window.ElecnorUI;
  const form = document.getElementById('card-form');
  const resetButton = document.getElementById('reset-card-form');
  const statusChip = document.getElementById('card-form-status');
  const dniSelect = document.getElementById('dni');
  const centerInput = document.getElementById('centro');
  const stateSelect = document.getElementById('estado');
  const notesInput = document.getElementById('notas');
  const idInput = document.getElementById('idTarjeta');

  const cardsBody = document.getElementById('cards-body');
  const filterInput = document.getElementById('card-filter');
  const stateFilter = document.getElementById('state-filter');
  const openModalButton = document.getElementById('open-card-modal');
  const cardModal = document.getElementById('card-modal');
  const modalClosers = cardModal ? cardModal.querySelectorAll('[data-modal-close]') : [];

  const stateLabels = {
    activa: 'Activa',
    suspendida: 'Suspendida',
    bloqueada: 'Bloqueada'
  };

  const setModalOpen = (open) => {
    if (!cardModal) return;
    cardModal.classList.toggle('modal--open', open);
    cardModal.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('modal-open', open);
    if (open) {
      requestAnimationFrame(() => idInput?.focus());
    }
  };

  const normalize = (value) => value.trim();

  const setStatus = (message, tone = 'muted') => {
    statusChip.textContent = message;
    statusChip.className = `badge badge--${tone}`;
  };

  const loadUserOptions = () => {
    const users = window.ElecnorData.getUsers();
    dniSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecciona un DNI';
    dniSelect.appendChild(placeholder);

    if (!users.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Primero crea usuarios';
      option.disabled = true;
      dniSelect.appendChild(option);
      dniSelect.disabled = true;
      return;
    }

    dniSelect.disabled = false;
    users
      .sort((a, b) => a.apellidos.localeCompare(b.apellidos, 'es'))
      .forEach((user) => {
        const option = document.createElement('option');
        option.value = user.dni;
        option.textContent = `${user.dni} · ${user.nombre} ${user.apellidos}`;
        dniSelect.appendChild(option);
      });
  };

  const suggestCenter = () => {
    const dni = normalize(dniSelect.value);
    const user = window.ElecnorData.getUserByDni(dni);
    if (user && !normalize(centerInput.value)) {
      centerInput.value = user.centro;
    }
  };

  const renderCards = () => {
    const term = normalize(filterInput.value).toLowerCase();
    const state = normalize(stateFilter.value).toLowerCase();

    const cards = window.ElecnorData.getCards()
      .filter((card) => {
        const matchesTerm =
          !term || card.idTarjeta.toLowerCase().includes(term) || card.dni.toLowerCase().includes(term);
        const matchesState = !state || card.estado.toLowerCase() === state;
        return matchesTerm && matchesState;
      })
      .sort((a, b) => a.idTarjeta.localeCompare(b.idTarjeta, 'es'));

    cardsBody.innerHTML = '';

    if (!cards.length) {
      const emptyRow = document.createElement('tr');
      emptyRow.className = 'table__row table__row--empty';
      const emptyCell = document.createElement('td');
      emptyCell.className = 'table__cell';
      emptyCell.colSpan = 6;
      emptyCell.textContent = 'No hay tarjetas que coincidan con el filtro.';
      emptyRow.appendChild(emptyCell);
      cardsBody.appendChild(emptyRow);
      return;
    }

    cards.forEach((card) => {
      const user = window.ElecnorData.getUserByDni(card.dni);
      const row = document.createElement('tr');
      row.className = 'table__row';

      const dniDisplay = user ? `${card.dni} · ${user.nombre} ${user.apellidos}` : card.dni;
      const cells = [card.idTarjeta, dniDisplay, card.centro || user?.centro || '—'];

      cells.forEach((value) => {
        const cell = document.createElement('td');
        cell.className = 'table__cell';
        cell.textContent = value;
        row.appendChild(cell);
      });

      const statusCell = document.createElement('td');
      statusCell.className = 'table__cell';
      const chip = document.createElement('span');
      chip.className = `estado-chip estado-${card.estado}`;
      chip.textContent = stateLabels[card.estado] || card.estado;
      statusCell.appendChild(chip);
      row.appendChild(statusCell);

      const notes = document.createElement('td');
      notes.className = 'table__cell muted';
      notes.textContent = card.notas || '—';
      row.appendChild(notes);

      const actions = document.createElement('td');
      actions.className = 'table__cell table__actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'cta cta--ghost';
      editBtn.type = 'button';
      editBtn.textContent = 'Editar';
      editBtn.setAttribute('aria-label', `Editar tarjeta ${card.idTarjeta}`);
      editBtn.addEventListener('click', () => {
        idInput.value = card.idTarjeta;
        dniSelect.value = card.dni;
        centerInput.value = card.centro || '';
        stateSelect.value = card.estado;
        notesInput.value = card.notas || '';
        clearFieldErrors(form);
        setStatus(`Editando ${card.idTarjeta}`, 'info');
        setModalOpen(true);
        idInput.focus();
      });

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'cta cta--secondary';
      toggleBtn.type = 'button';
      const nextState = card.estado === 'bloqueada' ? 'activa' : 'bloqueada';
      toggleBtn.textContent = nextState === 'activa' ? 'Activar' : 'Bloquear';
      toggleBtn.setAttribute('aria-label', `${toggleBtn.textContent} tarjeta ${card.idTarjeta}`);
      toggleBtn.addEventListener('click', async () => {
        try {
          await window.ElecnorData.toggleCardState(card.idTarjeta, nextState);
          showToast(
            `Tarjeta ${card.idTarjeta} ${nextState === 'activa' ? 'activada' : 'bloqueada'}`,
            'info'
          );
          renderCards();
        } catch (error) {
          showToast('No se pudo actualizar la tarjeta', 'error');
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'cta cta--danger';
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.setAttribute('aria-label', `Eliminar tarjeta ${card.idTarjeta}`);
      deleteBtn.addEventListener('click', async () => {
        const confirmed = await confirmAction({
          title: '¿Eliminar tarjeta?',
          message: `¿Estás seguro de eliminar la tarjeta ${card.idTarjeta}? Esta acción no se puede deshacer.`,
          confirmLabel: 'Eliminar tarjeta'
        });
        if (!confirmed) return;
        try {
          await window.ElecnorData.deleteCard(card.idTarjeta);
          showToast(`Tarjeta ${card.idTarjeta} eliminada`, 'success');
          renderCards();
        } catch (error) {
          showToast('No se pudo eliminar la tarjeta', 'error');
        }
      });

      actions.append(editBtn, toggleBtn, deleteBtn);
      row.appendChild(actions);
      cardsBody.appendChild(row);
    });
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    clearFieldErrors(form);

    const payload = {
      idTarjeta: normalize(idInput.value).toUpperCase(),
      dni: normalize(dniSelect.value).toUpperCase(),
      centro: normalize(centerInput.value).toUpperCase(),
      estado: normalize(stateSelect.value) || 'activa',
      notas: normalize(notesInput.value)
    };

    let isValid = true;
    if (!payload.idTarjeta) {
      showFieldError(idInput, 'El ID de tarjeta es obligatorio');
      isValid = false;
    }
    if (!payload.dni) {
      showFieldError(dniSelect, 'Debes seleccionar un DNI');
      isValid = false;
    }
    if (!isValid) {
      setStatus('Corrige los errores antes de guardar', 'alert');
      return;
    }

    const user = window.ElecnorData.getUserByDni(payload.dni);
    if (!payload.centro && user?.centro) {
      payload.centro = user.centro;
    }

    try {
      await window.ElecnorData.upsertCard(payload);
      setStatus(`Tarjeta ${payload.idTarjeta} guardada`, 'ok');
      showToast(`✓ Tarjeta ${payload.idTarjeta} guardada correctamente`, 'success');
      renderCards();
      idInput.value = '';
      dniSelect.selectedIndex = 0;
      centerInput.value = '';
      stateSelect.value = 'activa';
      notesInput.value = '';
      clearFieldErrors(form);
    } catch (error) {
      setStatus('No se pudo guardar la tarjeta', 'alert');
      showToast('No se pudo guardar la tarjeta', 'error');
    }
  });

  const resetCardForm = (message = 'Formulario limpio') => {
    idInput.value = '';
    dniSelect.selectedIndex = 0;
    centerInput.value = '';
    stateSelect.selectedIndex = 0;
    notesInput.value = '';
    clearFieldErrors(form);
    setStatus(message, 'muted');
  };

  resetButton.addEventListener('click', () => {
    resetCardForm();
  });

  dniSelect.addEventListener('change', suggestCenter);
  const debouncedFilter = debounce(renderCards, 300);
  filterInput.addEventListener('input', debouncedFilter);
  stateFilter.addEventListener('change', renderCards);

  openModalButton?.addEventListener('click', () => {
    resetCardForm('Introduce la información de la tarjeta');
    suggestCenter();
    setModalOpen(true);
  });

  modalClosers.forEach((element) => {
    element.addEventListener('click', () => setModalOpen(false));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && cardModal?.classList.contains('modal--open')) {
      setModalOpen(false);
    }
  });

  const init = async () => {
    rewriteNavLinks();
    const session = await ensureSession();
    if (!session) return;
    applyNavAccess(session);
    await window.ElecnorData.init();
    loadUserOptions();
    suggestCenter();
    renderCards();
  };

  init();
})();
