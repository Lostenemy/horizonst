(() => {
  const { ensureSession, rewriteNavLinks } = window.ElecnorAuth;
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

    if (!users.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Primero crea usuarios';
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
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No hay tarjetas que coincidan con el filtro.';
      cardsBody.appendChild(empty);
      return;
    }

    cards.forEach((card) => {
      const user = window.ElecnorData.getUserByDni(card.dni);
      const row = document.createElement('div');
      row.className = 'table__row';

      const cells = [
        card.idTarjeta,
        user ? `${card.dni} · ${user.nombre} ${user.apellidos}` : card.dni,
        card.centro || user?.centro || '—'
      ];

      cells.forEach((value) => {
        const span = document.createElement('span');
        span.className = 'table__cell';
        span.textContent = value;
        row.appendChild(span);
      });

      const status = document.createElement('span');
      status.className = `table__cell status status--${card.estado}`;
      status.textContent = card.estado;
      row.appendChild(status);

      const notes = document.createElement('span');
      notes.className = 'table__cell muted';
      notes.textContent = card.notas || '—';
      row.appendChild(notes);

      const actions = document.createElement('div');
      actions.className = 'table__cell table__actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'cta cta--ghost';
      editBtn.type = 'button';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', () => {
        idInput.value = card.idTarjeta;
        dniSelect.value = card.dni;
        centerInput.value = card.centro || '';
        stateSelect.value = card.estado;
        notesInput.value = card.notas || '';
        setStatus(`Editando ${card.idTarjeta}`, 'info');
        setModalOpen(true);
        idInput.focus();
      });

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'cta cta--secondary';
      toggleBtn.type = 'button';
      toggleBtn.textContent = card.estado === 'bloqueada' ? 'Activar' : 'Bloquear';
      toggleBtn.addEventListener('click', () => {
        const nextState = card.estado === 'bloqueada' ? 'activa' : 'bloqueada';
        window.ElecnorData.toggleCardState(card.idTarjeta, nextState);
        renderCards();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'cta cta--danger';
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.addEventListener('click', () => {
        if (confirm(`¿Eliminar la tarjeta ${card.idTarjeta}?`)) {
          window.ElecnorData.deleteCard(card.idTarjeta);
          renderCards();
        }
      });

      actions.append(editBtn, toggleBtn, deleteBtn);
      row.appendChild(actions);
      cardsBody.appendChild(row);
    });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const payload = {
      idTarjeta: normalize(idInput.value).toUpperCase(),
      dni: normalize(dniSelect.value).toUpperCase(),
      centro: normalize(centerInput.value).toUpperCase(),
      estado: normalize(stateSelect.value) || 'activa',
      notas: normalize(notesInput.value)
    };

    if (!payload.idTarjeta || !payload.dni) {
      setStatus('El ID de tarjeta y el DNI son obligatorios', 'alert');
      return;
    }

    const user = window.ElecnorData.getUserByDni(payload.dni);
    if (!payload.centro && user?.centro) {
      payload.centro = user.centro;
    }

    window.ElecnorData.upsertCard(payload);
    setStatus(`Tarjeta ${payload.idTarjeta} guardada`, 'ok');
    renderCards();
    form.reset();
    stateSelect.value = 'activa';
    suggestCenter();
  });

  resetButton.addEventListener('click', () => {
    form.reset();
    stateSelect.value = 'activa';
    suggestCenter();
    setStatus('Formulario limpio', 'muted');
  });

  dniSelect.addEventListener('change', suggestCenter);
  filterInput.addEventListener('input', renderCards);
  stateFilter.addEventListener('change', renderCards);

  openModalButton?.addEventListener('click', () => {
    form.reset();
    stateSelect.value = 'activa';
    suggestCenter();
    setStatus('Introduce la información de la tarjeta', 'muted');
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
    loadUserOptions();
    suggestCenter();
    renderCards();
  };

  init();
})();
