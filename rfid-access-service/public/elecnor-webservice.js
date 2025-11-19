(() => {
  const { withBasePath, fetchJson, ensureSession, rewriteNavLinks } = window.ElecnorAuth;

  const ecoordinaForm = document.getElementById('ecoordina-form');
  const ecoordinaUrl = document.getElementById('ecoordina-url');
  const ecoordinaUser = document.getElementById('ecoordina-user');
  const ecoordinaToken = document.getElementById('ecoordina-token');
  const ecoordinaAction = document.getElementById('ecoordina-action');
  const ecoordinaActionType = document.getElementById('ecoordina-action-type');
  const ecoordinaInstance = document.getElementById('ecoordina-instance');
  const ecoordinaInput = document.getElementById('ecoordina-input');
  const ecoordinaOutput = document.getElementById('ecoordina-output');
  const ecoordinaCentro = document.getElementById('ecoordina-centro');
  const ecoordinaCif = document.getElementById('ecoordina-cif');
  const ecoordinaDni = document.getElementById('ecoordina-dni');
  const ecoordinaNombre = document.getElementById('ecoordina-nombre');
  const ecoordinaApellidos = document.getElementById('ecoordina-apellidos');
  const ecoordinaPayload = document.getElementById('ecoordina-payload');
  const ecoordinaError = document.getElementById('ecoordina-error');
  const ecoordinaResponse = document.getElementById('ecoordina-response');
  const ecoordinaAccessCard = document.getElementById('ecoordina-access-card');
  const ecoordinaAccessBadge = document.getElementById('ecoordina-access-badge');
  const ecoordinaStatusBadge = document.getElementById('ecoordina-status-badge');
  const ecoordinaWorkerName = document.getElementById('ecoordina-worker');
  const ecoordinaWorkerDni = document.getElementById('ecoordina-worker-dni');
  const ecoordinaCompany = document.getElementById('ecoordina-company');
  const ecoordinaCenter = document.getElementById('ecoordina-center');
  const ecoordinaDocCount = document.getElementById('ecoordina-doc-count');
  const ecoordinaDocsList = document.getElementById('ecoordina-docs');
  const ecoordinaResetButton = document.getElementById('ecoordina-reset');
  const ecoordinaSubmitButton = document.getElementById('ecoordina-submit');

  let ecoordinaDefaults = null;

  const buildEcoordinaData = () => ({
    centro_cod: ecoordinaCentro.value.trim().toUpperCase(),
    empresa_cif: ecoordinaCif.value.trim().toUpperCase(),
    trabajador_dni: ecoordinaDni.value.trim().toUpperCase()
  });

  const resetResultCard = () => {
    ecoordinaAccessCard.classList.add('hidden');
    ecoordinaDocsList.innerHTML = '';
    ecoordinaAccessBadge.className = 'badge badge--neutral';
    ecoordinaAccessBadge.textContent = 'Pendiente';
    ecoordinaStatusBadge.className = 'badge badge--muted';
    ecoordinaStatusBadge.textContent = 'Status --';
  };

  const interpretAccessFlag = (value) => {
    if (value === undefined || value === null) {
      return { allowed: null, label: '--' };
    }

    if (typeof value === 'number') {
      return { allowed: value === 1, label: String(value) };
    }

    const normalized = String(value).trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'ok' || normalized === 'verde') {
      return { allowed: true, label: String(value).trim() };
    }

    if (normalized === '0' || normalized === 'false' || normalized === 'ko' || normalized === 'rojo') {
      return { allowed: false, label: String(value).trim() };
    }

    return { allowed: null, label: String(value).trim() };
  };

  const parseEcoordinaData = (data) => {
    if (!data) return null;
    if (typeof data === 'string') {
      try {
        return parseEcoordinaData(JSON.parse(data));
      } catch (error) {
        console.warn('No se pudo interpretar la respuesta JSON de e-coordina', error);
        return null;
      }
    }

    if (typeof data === 'object') {
      if ('response' in data && typeof data.response === 'object') {
        return data.response;
      }
      return data;
    }

    return null;
  };

  const renderDocs = (docs) => {
    ecoordinaDocsList.innerHTML = '';
    if (!Array.isArray(docs) || docs.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'Sin incidencias registradas.';
      ecoordinaDocsList.appendChild(li);
      ecoordinaDocCount.textContent = '0';
      ecoordinaDocCount.className = 'badge badge--ok';
      return;
    }

    ecoordinaDocCount.textContent = String(docs.length);
    ecoordinaDocCount.className = 'badge badge--alert';

    const maxItems = 5;
    docs.slice(0, maxItems).forEach((doc) => {
      const li = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = doc.documento || doc.display || `Documento ${doc.id ?? ''}`.trim();
      li.appendChild(title);

      const meta = document.createElement('span');
      meta.className = 'doc-list__state';
      const estado = doc.documentacion_estado || doc.documento_tipo || 'Pendiente';
      meta.textContent = estado;
      li.appendChild(meta);

      const detail = document.createElement('p');
      detail.className = 'muted';
      const fecha = doc.fecha_limite || doc.fecha_caducidad || doc.fecha_solicitado;
      detail.textContent = fecha ? `Límite: ${fecha}` : doc.empresa || '';
      li.appendChild(detail);

      ecoordinaDocsList.appendChild(li);
    });

    if (docs.length > maxItems) {
      const remaining = document.createElement('li');
      remaining.className = 'muted';
      remaining.textContent = `+${docs.length - maxItems} documentos adicionales.`;
      ecoordinaDocsList.appendChild(remaining);
    }
  };

  const renderEcoordinaResult = (payload) => {
    const container = parseEcoordinaData(payload);
    if (!container) {
      resetResultCard();
      return;
    }

    const worker = typeof container.trabajador === 'object' ? container.trabajador : {};
    const accessFlag = interpretAccessFlag(container.acceso ?? container.access);
    const statusLabel = container.status !== undefined ? `Status ${container.status}` : 'Status --';

    let badgeClass = 'badge badge--info';
    let badgeText = `Acceso (${accessFlag.label})`;
    if (accessFlag.allowed === true) {
      badgeClass = 'badge badge--success';
      badgeText = `Acceso permitido (${accessFlag.label})`;
    } else if (accessFlag.allowed === false) {
      badgeClass = 'badge badge--danger';
      badgeText = `Acceso denegado (${accessFlag.label})`;
    }

    ecoordinaAccessBadge.className = badgeClass;
    ecoordinaAccessBadge.textContent = badgeText;
    ecoordinaStatusBadge.className = container.status === '1' ? 'badge badge--ok' : 'badge badge--muted';
    ecoordinaStatusBadge.textContent = statusLabel;

    ecoordinaWorkerName.textContent = worker.trabajador || '—';
    const dni = worker.dni || ecoordinaDni.value.trim().toUpperCase() || '—';
    ecoordinaWorkerDni.textContent = `DNI ${dni}`;
    ecoordinaCompany.textContent = worker.empresa || '—';
    ecoordinaCenter.textContent = worker.centro || ecoordinaCentro.value.trim().toUpperCase() || '—';

    const docs = container.data?.documentacion_incumplimiento;
    renderDocs(Array.isArray(docs) ? docs : []);

    ecoordinaAccessCard.classList.remove('hidden');
  };

  const refreshEcoordinaPreview = () => {
    const requestData = buildEcoordinaData();
    ecoordinaPayload.value = JSON.stringify(
      {
        user: ecoordinaUser.value.trim(),
        token: ecoordinaToken.value.trim(),
        instance: ecoordinaInstance.value.trim(),
        in: ecoordinaInput.value.trim(),
        out: ecoordinaOutput.value.trim(),
        action_type: ecoordinaActionType.value.trim(),
        action: ecoordinaAction.value.trim(),
        data: {
          data: requestData
        }
      },
      null,
      2
    );
  };

  const hydrateEcoordinaDefaults = (defaults) => {
    ecoordinaDefaults = defaults;
    ecoordinaUrl.value = defaults.url ?? '';
    ecoordinaUser.value = defaults.user ?? '';
    ecoordinaToken.value = defaults.token ?? '';
    ecoordinaAction.value = defaults.action ?? '';
    ecoordinaActionType.value = defaults.actionType ?? '';
    ecoordinaInstance.value = defaults.instance ?? '';
    ecoordinaInput.value = defaults.inputFormat ?? '';
    ecoordinaOutput.value = defaults.outputFormat ?? '';
    refreshEcoordinaPreview();
  };

  const loadEcoordinaDefaults = async () => {
    try {
      const result = await fetchJson(withBasePath('/api/ecoordina/defaults'));
      if (result?.defaults) {
        hydrateEcoordinaDefaults(result.defaults);
      }
    } catch (error) {
      console.warn('No se pudieron cargar los valores por defecto de e-coordina', error);
    }
  };

  ecoordinaResetButton.addEventListener('click', () => {
    if (!ecoordinaDefaults) return;
    hydrateEcoordinaDefaults(ecoordinaDefaults);
    ecoordinaCentro.value = '';
    ecoordinaCif.value = '';
    ecoordinaDni.value = '';
    ecoordinaNombre.value = '';
    ecoordinaApellidos.value = '';
    ecoordinaError.hidden = true;
    ecoordinaError.textContent = '';
    ecoordinaResponse.classList.add('hidden');
    ecoordinaResponse.textContent = '';
    resetResultCard();
    refreshEcoordinaPreview();
  });

  [
    ecoordinaCentro,
    ecoordinaCif,
    ecoordinaDni,
    ecoordinaUrl,
    ecoordinaUser,
    ecoordinaToken,
    ecoordinaAction,
    ecoordinaActionType,
    ecoordinaInstance,
    ecoordinaInput,
    ecoordinaOutput
  ].forEach((input) => {
    input.addEventListener('input', refreshEcoordinaPreview);
  });

  ecoordinaSubmitButton.addEventListener('click', async () => {
    ecoordinaError.hidden = true;
    ecoordinaError.textContent = '';
    ecoordinaResponse.classList.add('hidden');
    ecoordinaResponse.textContent = '';
    resetResultCard();

    const payload = buildEcoordinaData();

    if (!payload.centro_cod || !payload.empresa_cif || !payload.trabajador_dni) {
      ecoordinaError.textContent = 'Centro, CIF y DNI son obligatorios para la petición.';
      ecoordinaError.hidden = false;
      return;
    }

    try {
      const response = await fetchJson(withBasePath('/api/ecoordina/test'), {
        method: 'POST',
        body: JSON.stringify({
          url: ecoordinaUrl.value,
          user: ecoordinaUser.value,
          token: ecoordinaToken.value,
          action: ecoordinaAction.value,
          actionType: ecoordinaActionType.value,
          instance: ecoordinaInstance.value,
          inputFormat: ecoordinaInput.value,
          outputFormat: ecoordinaOutput.value,
          ...payload
        })
      });

      renderEcoordinaResult(response.data);
      ecoordinaResponse.textContent = JSON.stringify(response, null, 2);
      ecoordinaResponse.classList.remove('hidden');
    } catch (error) {
      ecoordinaError.textContent =
        error instanceof Error ? error.message : 'No se pudo contactar con e-coordina. Revise la consola.';
      ecoordinaError.hidden = false;
      resetResultCard();
    }
  });

  const init = async () => {
    rewriteNavLinks();
    const session = await ensureSession();
    if (!session) return;
    await loadEcoordinaDefaults();
    refreshEcoordinaPreview();
  };

  ecoordinaForm.addEventListener('submit', (event) => event.preventDefault());
  init();
})();
