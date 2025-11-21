(() => {
  const statusBadge = document.getElementById('gpo-status');
  const errorBox = document.getElementById('gpo-error');
  const baseUrlField = document.getElementById('gpo-base-url');
  const baseUrlForm = document.getElementById('gpo-base-url-form');
  const baseUrlInput = document.getElementById('gpo-base-url-input');
  const pathModeField = document.getElementById('gpo-path-mode');
  const pathModeForm = document.getElementById('gpo-path-mode-form');
  const pathModeMulti = document.getElementById('gpo-path-multi');
  const pathModeSingle = document.getElementById('gpo-path-single');
  const deviceIdField = document.getElementById('gpo-device-id');
  const deviceIdForm = document.getElementById('gpo-device-id-form');
  const deviceIdInput = document.getElementById('gpo-device-id-input');
  const authUserField = document.getElementById('gpo-auth-user');
  const credentialsForm = document.getElementById('gpo-credentials-form');
  const usernameInput = document.getElementById('gpo-username');
  const passwordInput = document.getElementById('gpo-password');
  const linesField = document.getElementById('gpo-lines');
  const scenarioGranted = document.getElementById('gpo-scenario-granted');
  const scenarioDenied = document.getElementById('gpo-scenario-denied');
  const lineForm = document.getElementById('gpo-line-form');
  const lineSelect = document.getElementById('gpo-line');
  const actionSelect = document.getElementById('gpo-action');
  const durationInput = document.getElementById('gpo-duration');
  const apiResponseBox = document.getElementById('gpo-api-response');

  const { ensureSession, fetchJson, withBasePath, rewriteNavLinks, applyNavAccess } = window.ElecnorAuth;
  const { showToast } = window.ElecnorUI;

  let controllerEnabled = false;

  const setError = (message) => {
    if (!errorBox) return;
    if (message) {
      errorBox.textContent = message;
      errorBox.hidden = false;
    } else {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }
  };

  const toggleLoading = (loading) => {
    [
      scenarioGranted,
      scenarioDenied,
      lineForm?.querySelector('button[type="submit"]'),
      baseUrlForm?.querySelector('button[type="submit"]'),
      pathModeForm?.querySelector('button[type="submit"]'),
      deviceIdForm?.querySelector('button[type="submit"]'),
      credentialsForm?.querySelector('button[type="submit"]')
    ].forEach((btn) => {
      if (!btn) return;
      btn.disabled = loading;
      btn.setAttribute('aria-busy', loading ? 'true' : 'false');
    });
  };

  const renderApiResponse = (label, payload, isError = false) => {
    if (!apiResponseBox) return;
    const timestamp = new Date().toLocaleTimeString();
    const status = isError ? 'error' : 'ok';
    const body = payload ? JSON.stringify(payload, null, 2) : '—';
    apiResponseBox.textContent = `${timestamp} · ${label} (${status})\n${body}`;
    apiResponseBox.dataset.state = status;
  };

  const renderStatus = (status = {}) => {
    controllerEnabled = Boolean(status.enabled);
    if (statusBadge) {
      statusBadge.textContent = controllerEnabled ? 'GPIO habilitado' : 'GPIO desactivado';
      statusBadge.className = `badge badge--${controllerEnabled ? 'success' : 'danger'}`;
    }

    if (baseUrlField) baseUrlField.textContent = status.baseUrl || '—';
    if (baseUrlInput) baseUrlInput.value = status.baseUrl || '';
    if (pathModeField)
      pathModeField.textContent =
        status.pathMode === 'single-device'
          ? 'Ruta única: /device/gpo/{line}/{state}'
          : 'Ruta por deviceId: /devices/{id}/setGPO/{line}/{state}';
    if (pathModeSingle) pathModeSingle.checked = Boolean(status.singleDeviceMode);
    if (pathModeMulti) pathModeMulti.checked = !status.singleDeviceMode;
    if (deviceIdField) deviceIdField.textContent = status.deviceId || '—';
    if (deviceIdInput) deviceIdInput.value = status.deviceId || '';
    if (authUserField) authUserField.textContent = status.auth?.configured
      ? `Usuario ${status.auth.username || '(oculto)'}`
      : 'Sin usuario';
    if (usernameInput && status.auth?.username) usernameInput.value = status.auth.username;
    if (!status.auth?.configured) {
      if (usernameInput) usernameInput.value = '';
      if (passwordInput) passwordInput.value = '';
    }
    if (linesField) linesField.textContent = Array.isArray(status.allowedLines)
      ? status.allowedLines.join(', ')
      : '—';

    if (!controllerEnabled) {
      const reason = status.disabledReason;
      const message =
        reason === 'MISSING_BASE_URL'
          ? 'Configura la URL base del lector (RFID_READER_CONTROLLER_BASE_URL) para activar el GPIO.'
          : reason === 'MISSING_DEVICE_ID'
            ? 'Configura el deviceId del lector (RFID_READER_DEVICE_ID) o activa el modo de ruta única.'
          : reason === 'DISABLED_FLAG'
            ? 'El control GPIO está deshabilitado en la variable RFID_READER_CONTROLLER_ENABLED.'
            : 'No se puede controlar el GPIO hasta completar la configuración del lector.';
      setError(message);
    }

    deviceIdForm?.querySelectorAll('button, input').forEach((el) => {
      if (!(el instanceof HTMLButtonElement || el instanceof HTMLInputElement)) return;
      const disable = Boolean(status.singleDeviceMode) || (!controllerEnabled && el instanceof HTMLButtonElement);
      el.disabled = disable;
    });

    const formElements = lineForm ? Array.from(lineForm.elements) : [];
    formElements.forEach((el) => {
      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
        el.disabled = !controllerEnabled && el.name !== 'action';
      }
    });

    [scenarioGranted, scenarioDenied].forEach((btn) => {
      if (btn) btn.disabled = !controllerEnabled;
    });
  };

  const loadStatus = async () => {
    setError('');
    try {
      const { status } = await fetchJson(withBasePath('/api/gpo/status'));
      renderStatus(status);
      renderApiResponse('Estado', status);
    } catch (error) {
      setError('No se pudo obtener el estado del GPIO.');
      if (statusBadge) {
        statusBadge.textContent = 'Estado desconocido';
        statusBadge.className = 'badge badge--muted';
      }
      renderApiResponse('Estado', error?.payload || { error: error?.message || 'Fallo al consultar el estado' }, true);
    }
  };

  const handleBaseUrlSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const baseUrl = baseUrlInput?.value?.trim() || '';
    if (!baseUrl) {
      setError('Introduce una URL válida del lector (por ejemplo http://88.20.2.60).');
      return;
    }

    toggleLoading(true);
    try {
      const { status } = await fetchJson(withBasePath('/api/gpo/base-url'), {
        method: 'POST',
        body: JSON.stringify({ baseUrl })
      });
      renderStatus(status);
      renderApiResponse('Actualizar URL', status);
      showToast('URL del lector actualizada para las pruebas', 'success');
    } catch (error) {
      const message =
        error?.message === 'INVALID_BASE_URL'
          ? 'Introduce una URL válida (ejemplo: http://88.20.2.60).'
          : 'No se pudo actualizar la URL del lector. Revisa la configuración o los logs.';
      setError(message);
      renderApiResponse('Actualizar URL', error?.payload || { error: error?.message || 'No se pudo actualizar la URL' }, true);
    } finally {
      toggleLoading(false);
    }
  };

  const handlePathModeSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const singleDeviceMode = Boolean(pathModeSingle?.checked);

    toggleLoading(true);
    try {
      const { status } = await fetchJson(withBasePath('/api/gpo/path-mode'), {
        method: 'POST',
        body: JSON.stringify({ singleDeviceMode })
      });
      renderStatus(status);
      renderApiResponse('Modo de ruta', status);
      showToast('Modo de ruta actualizado', 'success');
    } catch (error) {
      const message = error?.message || 'No se pudo actualizar el modo de ruta.';
      setError(message);
      renderApiResponse('Modo de ruta', error?.payload || { error: message }, true);
    } finally {
      toggleLoading(false);
    }
  };

  const handleDeviceIdSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const deviceId = deviceIdInput?.value?.trim() || '';
    if (!deviceId) {
      setError('Introduce el deviceId que publica el lector en /devices para componer la ruta setGPO.');
      return;
    }

    toggleLoading(true);
    try {
      const { status } = await fetchJson(withBasePath('/api/gpo/device-id'), {
        method: 'POST',
        body: JSON.stringify({ deviceId })
      });
      renderStatus(status);
      renderApiResponse('Device ID', status);
      showToast('Device ID actualizado para las pruebas', 'success');
    } catch (error) {
      const message = error?.message || 'No se pudo actualizar el deviceId del lector.';
      setError(message);
      renderApiResponse('Device ID', error?.payload || { error: message }, true);
    } finally {
      toggleLoading(false);
    }
  };

  const handleCredentialsSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const username = usernameInput?.value?.trim() || '';
    const password = passwordInput?.value || '';

    if ((username && !password) || (!username && password)) {
      setError('Introduce usuario y contraseña para activar la autenticación o deja ambos vacíos para borrar.');
      return;
    }

    toggleLoading(true);
    try {
      const { status } = await fetchJson(withBasePath('/api/gpo/credentials'), {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      renderStatus(status);
      renderApiResponse('Credenciales', status);
      showToast('Credenciales del lector guardadas para las pruebas', 'success');
      if (!username && passwordInput) passwordInput.value = '';
    } catch (error) {
      const message = error?.message || 'No se pudieron guardar las credenciales del lector.';
      setError(message);
      renderApiResponse('Credenciales', error?.payload || { error: message }, true);
    } finally {
      toggleLoading(false);
    }
  };

  const runScenario = async (scenario) => {
    setError('');
    toggleLoading(true);
    try {
      const response = await fetchJson(withBasePath('/api/gpo/test/scenario'), {
        method: 'POST',
        body: JSON.stringify({ scenario })
      });
      const label = scenario === 'granted' ? 'permitido' : 'denegado';
      showToast(`Escenario de acceso ${label} enviado`, 'success');
      renderApiResponse('Escenario', response);
    } catch (error) {
      const message =
        error?.message === 'GPO_DISABLED'
          ? 'El control GPIO está desactivado en la configuración.'
          : 'No se pudo ejecutar la prueba. Revisa la configuración del lector y los logs.';
      setError(message);
      renderApiResponse('Escenario', error?.payload || { error: error?.message || 'No se pudo ejecutar la prueba' }, true);
    } finally {
      toggleLoading(false);
    }
  };

  const handleLineSubmit = async (event) => {
    event.preventDefault();
    setError('');
    toggleLoading(true);

    const line = Number.parseInt(lineSelect?.value || '0', 10);
    const action = actionSelect?.value || 'pulse';
    const duration = durationInput?.value ? Number(durationInput.value) : undefined;

    try {
      const response = await fetchJson(withBasePath('/api/gpo/test/line'), {
        method: 'POST',
        body: JSON.stringify({ line, action, durationMs: duration })
      });
      const actionLabel =
        action === 'pulse'
          ? `Pulso de ${duration || 1000} ms`
          : action === 'on'
            ? 'Encendido'
            : 'Apagado';
      showToast(`${actionLabel} enviado a la línea ${line}`, 'success');
      renderApiResponse('Línea manual', response);
    } catch (error) {
      const message = error?.message || 'No se pudo enviar la orden al lector.';
      setError(message);
      renderApiResponse('Línea manual', error?.payload || { error: error?.message || 'No se pudo enviar la orden' }, true);
    } finally {
      toggleLoading(false);
    }
  };

  const init = async () => {
    rewriteNavLinks(['.breadcrumb a', '.topbar__nav a']);
    const session = await ensureSession(true);
    if (!session) return;
    applyNavAccess(session);
    await loadStatus();
  };

  scenarioGranted?.addEventListener('click', () => runScenario('granted'));
  scenarioDenied?.addEventListener('click', () => runScenario('denied'));
  lineForm?.addEventListener('submit', handleLineSubmit);
  baseUrlForm?.addEventListener('submit', handleBaseUrlSubmit);
  pathModeForm?.addEventListener('submit', handlePathModeSubmit);
  deviceIdForm?.addEventListener('submit', handleDeviceIdSubmit);
  credentialsForm?.addEventListener('submit', handleCredentialsSubmit);

  init();
})();
