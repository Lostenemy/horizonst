(() => {
  const { withBasePath, fetchJson, ensureSession, rewriteNavLinks } = window.ElecnorAuth;

  const ecoordinaForm = document.getElementById('ecoordina-form');
  const ecoordinaUrl = document.getElementById('ecoordina-url');
  const ecoordinaUser = document.getElementById('ecoordina-user');
  const ecoordinaToken = document.getElementById('ecoordina-token');
  const ecoordinaBrand = document.getElementById('ecoordina-brand');
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
  const ecoordinaResetButton = document.getElementById('ecoordina-reset');
  const ecoordinaSubmitButton = document.getElementById('ecoordina-submit');

  let ecoordinaDefaults = null;

  const buildEcoordinaData = () => ({
    centro_cod: ecoordinaCentro.value.trim().toUpperCase(),
    empresa_cif: ecoordinaCif.value.trim().toUpperCase(),
    trabajador_dni: ecoordinaDni.value.trim().toUpperCase()
  });

  const refreshEcoordinaPreview = () => {
    ecoordinaPayload.value = JSON.stringify({ data: buildEcoordinaData() }, null, 2);
  };

  const hydrateEcoordinaDefaults = (defaults) => {
    ecoordinaDefaults = defaults;
    ecoordinaUrl.value = defaults.url ?? '';
    ecoordinaUser.value = defaults.user ?? '';
    ecoordinaToken.value = defaults.token ?? '';
    ecoordinaBrand.value = defaults.brand ?? '';
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
    refreshEcoordinaPreview();
  });

  [
    ecoordinaCentro,
    ecoordinaCif,
    ecoordinaDni,
    ecoordinaUrl,
    ecoordinaUser,
    ecoordinaToken,
    ecoordinaBrand,
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
          brand: ecoordinaBrand.value,
          action: ecoordinaAction.value,
          actionType: ecoordinaActionType.value,
          instance: ecoordinaInstance.value,
          inputFormat: ecoordinaInput.value,
          outputFormat: ecoordinaOutput.value,
          ...payload
        })
      });

      ecoordinaResponse.textContent = JSON.stringify(response, null, 2);
      ecoordinaResponse.classList.remove('hidden');
    } catch (error) {
      ecoordinaError.textContent =
        error instanceof Error ? error.message : 'No se pudo contactar con e-coordina. Revise la consola.';
      ecoordinaError.hidden = false;
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
