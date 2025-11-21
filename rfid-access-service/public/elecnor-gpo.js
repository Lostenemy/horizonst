(() => {
  const statusBadge = document.getElementById('gpo-status');
  const errorBox = document.getElementById('gpo-error');
  const baseUrlField = document.getElementById('gpo-base-url');
  const baseUrlForm = document.getElementById('gpo-base-url-form');
  const baseUrlInput = document.getElementById('gpo-base-url-input');
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
      baseUrlForm?.querySelector('button[type="submit"]')
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
    if (linesField) linesField.textContent = Array.isArray(status.allowedLines)
      ? status.allowedLines.join(', ')
      : '—';

    if (!controllerEnabled) {
      const reason = status.disabledReason;
      const message =
        reason === 'MISSING_BASE_URL'
          ? 'Configura la URL base del lector (RFID_READER_CONTROLLER_BASE_URL) para activar el GPIO.'
          : reason === 'DISABLED_FLAG'
            ? 'El control GPIO está deshabilitado en la variable RFID_READER_CONTROLLER_ENABLED.'
            : 'No se puede controlar el GPIO hasta completar la configuración del lector.';
      setError(message);
    }

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
      renderApiResponse('Estado', { error: error?.message || 'Fallo al consultar el estado' }, true);
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
      renderApiResponse('Actualizar URL', { error: error?.message || 'No se pudo actualizar la URL' }, true);
    } finally {
      toggleLoading(false);
    }
  };

  const runScenario = async (scenario) => {
    setError('');
    toggleLoading(true);
    try {
      await fetchJson(withBasePath('/api/gpo/test/scenario'), {
        method: 'POST',
        body: JSON.stringify({ scenario })
      });
      const label = scenario === 'granted' ? 'permitido' : 'denegado';
      showToast(`Escenario de acceso ${label} enviado`, 'success');
      renderApiResponse('Escenario', { ok: true, decision: label });
    } catch (error) {
      const message =
        error?.message === 'GPO_DISABLED'
          ? 'El control GPIO está desactivado en la configuración.'
          : 'No se pudo ejecutar la prueba. Revisa la configuración del lector y los logs.';
      setError(message);
      renderApiResponse('Escenario', { error: error?.message || 'No se pudo ejecutar la prueba' }, true);
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
      await fetchJson(withBasePath('/api/gpo/test/line'), {
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
      renderApiResponse('Línea manual', { ok: true, line, action, durationMs: action === 'pulse' ? duration || 1000 : undefined });
    } catch (error) {
      const message = error?.message || 'No se pudo enviar la orden al lector.';
      setError(message);
      renderApiResponse('Línea manual', { error: error?.message || 'No se pudo enviar la orden' }, true);
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

  init();
})();
