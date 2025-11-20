(() => {
  const statusBadge = document.getElementById('gpo-status');
  const errorBox = document.getElementById('gpo-error');
  const baseUrlField = document.getElementById('gpo-base-url');
  const deviceField = document.getElementById('gpo-device');
  const linesField = document.getElementById('gpo-lines');
  const scenarioGranted = document.getElementById('gpo-scenario-granted');
  const scenarioDenied = document.getElementById('gpo-scenario-denied');
  const lineForm = document.getElementById('gpo-line-form');
  const lineSelect = document.getElementById('gpo-line');
  const actionSelect = document.getElementById('gpo-action');
  const durationInput = document.getElementById('gpo-duration');

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
    [scenarioGranted, scenarioDenied, lineForm?.querySelector('button[type="submit"]')].forEach((btn) => {
      if (!btn) return;
      btn.disabled = loading;
      btn.setAttribute('aria-busy', loading ? 'true' : 'false');
    });
  };

  const renderStatus = (status = {}) => {
    controllerEnabled = Boolean(status.enabled);
    if (statusBadge) {
      statusBadge.textContent = controllerEnabled ? 'GPIO habilitado' : 'GPIO desactivado';
      statusBadge.className = `badge badge--${controllerEnabled ? 'success' : 'danger'}`;
    }

    if (baseUrlField) baseUrlField.textContent = status.baseUrl || '—';
    if (deviceField) deviceField.textContent = status.deviceId || '—';
    if (linesField) linesField.textContent = Array.isArray(status.allowedLines)
      ? status.allowedLines.join(', ')
      : '—';

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
    } catch (error) {
      setError('No se pudo obtener el estado del GPIO.');
      if (statusBadge) {
        statusBadge.textContent = 'Estado desconocido';
        statusBadge.className = 'badge badge--muted';
      }
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
    } catch (error) {
      const message =
        error?.message === 'GPO_DISABLED'
          ? 'El control GPIO está desactivado en la configuración.'
          : 'No se pudo ejecutar la prueba. Revisa la configuración del lector y los logs.';
      setError(message);
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
    } catch (error) {
      const message = error?.message || 'No se pudo enviar la orden al lector.';
      setError(message);
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

  init();
})();
