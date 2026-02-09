(() => {
  const { withBasePath, fetchJson, ensureSession, rewriteNavLinks, applyNavAccess } = window.ElecnorAuth;
  const { clearFieldErrors, debounce } = window.ElecnorUI;

  const simulateForm = document.getElementById('simulate-form');
  const simulateError = document.getElementById('simulate-error');
  const simulateResult = document.getElementById('simulate-result');
  const cardInput = document.getElementById('simulate-card-id');
  const macInput = document.getElementById('simulate-mac');
  const timestampInput = document.getElementById('simulate-timestamp');
  const additionalInput = document.getElementById('simulate-additional');
  const submitBtn = document.getElementById('simulate-submit');
  const useNowBtn = document.getElementById('use-current-timestamp');
  const resultTitle = document.getElementById('simulate-result-title');
  const resultSubtitle = document.getElementById('simulate-result-subtitle');
  const resultBody = document.getElementById('simulate-result-body');
  const resultState = document.getElementById('simulate-result-state');
  const macError = document.getElementById('mac-error');
  const cardError = document.getElementById('card-id-error');
  const timestampError = document.getElementById('timestamp-error');
  const additionalError = document.getElementById('additional-error');

  const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

  const setFieldError = (field, messageEl, message) => {
    field.classList.add('error');
    field.setAttribute('aria-invalid', 'true');
    if (messageEl) {
      messageEl.textContent = message;
      messageEl.hidden = false;
    }
  };

  const clearFieldState = (...entries) => {
    entries.forEach(([field, messageEl]) => {
      field?.classList.remove('error');
      field?.removeAttribute('aria-invalid');
      if (messageEl) {
        messageEl.hidden = true;
        messageEl.textContent = '';
      }
    });
  };

  const parseJsonSafely = (raw) => {
    if (!raw || raw.trim() === '') {
      return undefined;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error('El campo de datos adicionales no contiene un JSON válido.');
    }
  };

  const setResultState = (state, { title, subtitle } = {}) => {
    const classMap = {
      idle: 'status-chip--idle',
      loading: 'status-chip--loading',
      success: 'status-chip--success',
      error: 'status-chip--error'
    };
    resultState.className = `status-chip ${classMap[state] ?? ''}`;
    resultState.textContent =
      state === 'loading' ? 'Enviando…' : state === 'success' ? 'Completado' : state === 'error' ? 'Error' : 'Pendiente';

    if (title) resultTitle.textContent = title;
    if (subtitle) resultSubtitle.textContent = subtitle;
  };

  const renderResult = (event) => {
    simulateResult.classList.remove('hidden');
    simulateResult.classList.toggle('result-panel--success', event.decision === 'GRANTED');
    simulateResult.classList.toggle('result-panel--error', event.decision !== 'GRANTED');
    const success = event.decision === 'GRANTED';
    setResultState(success ? 'success' : 'error', {
      title: success ? 'Acceso concedido' : 'Acceso denegado',
      subtitle: success
        ? 'La simulación se completó correctamente.'
        : 'Revisa los datos y la respuesta del sistema.'
    });

    resultBody.innerHTML = '';

    const decisionCard = document.createElement('div');
    decisionCard.className = 'result-card';
    decisionCard.innerHTML = `
      <div class="result-card__header">
        <strong>${success ? 'Lectura válida' : 'Lectura rechazada'}</strong>
        <span class="badge ${success ? 'badge--ok' : 'badge--danger'}">${event.decision}</span>
      </div>
      <div class="result-meta">
        <div><span class="label-text">Tarjeta</span><div>${event.cardId}</div></div>
        <div><span class="label-text">MAC</span><div>${event.mac}</div></div>
        <div><span class="label-text">DNI</span><div>${event.dni ?? 'no asignado'}</div></div>
        <div><span class="label-text">Motivo</span><div>${event.reason || 'Motivo no especificado'}</div></div>
      </div>
    `;

    const pubsCard = document.createElement('div');
    pubsCard.className = 'result-card';
    pubsCard.innerHTML = `
      <div class="result-card__header">
        <strong>Publicaciones MQTT</strong>
      </div>
      <div class="result-meta">
        ${event.publications
          .map(
            (pub) => `
              <div>
                <small>Topic</small>
                <div class="mqtt-topic">${pub.topic}</div>
                <small>Payload</small>
                <div class="mqtt-topic">${pub.payload}</div>
              </div>
            `
          )
          .join('')}
      </div>
    `;

    resultBody.append(decisionCard, pubsCard);
  };

  const setLoading = (loading) => {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading ? '<span class="loading-spinner" aria-hidden="true"></span>Enviando…' : 'Enviar lectura';
    if (loading) {
      setResultState('loading', {
        title: 'Enviando lectura…',
        subtitle: 'Procesando la simulación.'
      });
    }
  };

  simulateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(simulateForm);
    clearFieldState([cardInput, cardError], [macInput, macError], [timestampInput, timestampError], [
      additionalInput,
      additionalError
    ]);
    simulateError.hidden = true;
    simulateError.textContent = '';

    const cardId = cardInput.value.trim();
    const mac = macInput.value.trim();

    let hasError = false;
    if (!cardId) {
      setFieldError(cardInput, cardError, 'El ID de tarjeta es obligatorio.');
      hasError = true;
    }

    if (!mac) {
      setFieldError(macInput, macError, 'La MAC del lector es obligatoria.');
      hasError = true;
    } else if (!macRegex.test(mac.toUpperCase())) {
      setFieldError(macInput, macError, 'Formato esperado: AA:BB:CC:DD:EE:FF');
      hasError = true;
    }

    let timestamp;
    if (timestampInput.value) {
      const parsed = new Date(timestampInput.value);
      if (Number.isNaN(parsed.getTime())) {
        setFieldError(timestampInput, timestampError, 'Introduce una fecha válida.');
        hasError = true;
        return;
      }
      timestamp = parsed.toISOString();
    }

    let additional;
    try {
      additional = parseJsonSafely(additionalInput.value);
    } catch (error) {
      additionalError.textContent = error.message;
      additionalError.hidden = false;
      setFieldError(additionalInput, additionalError, error.message);
      hasError = true;
    }

    if (hasError) {
      return;
    }

    try {
      setLoading(true);
      const result = await fetchJson(withBasePath('/api/simulate'), {
        method: 'POST',
        body: JSON.stringify({ cardId, mac, timestamp, additional })
      });

      renderResult(result);
    } catch (error) {
      resultBody.innerHTML = '';
      simulateError.textContent = error instanceof Error ? error.message : 'No se pudo ejecutar la simulación.';
      simulateError.hidden = false;
      setResultState('error', {
        title: 'No se pudo completar la simulación',
        subtitle: 'Revisa los datos o inténtalo de nuevo.'
      });
      simulateResult.classList.remove('hidden', 'result-panel--success');
      simulateResult.classList.add('result-panel--error');
    } finally {
      setLoading(false);
    }
  });

  const validateCard = () => {
    clearFieldState([cardInput, cardError]);
    if (cardInput.value.trim()) return true;
    setFieldError(cardInput, cardError, 'El ID de tarjeta es obligatorio.');
    return false;
  };

  const validateMac = () => {
    clearFieldState([macInput, macError]);
    const value = macInput.value.trim().toUpperCase();
    if (!value) {
      setFieldError(macInput, macError, 'La MAC del lector es obligatoria.');
      return false;
    }
    if (!macRegex.test(value)) {
      setFieldError(macInput, macError, 'Formato esperado: AA:BB:CC:DD:EE:FF');
      return false;
    }
    macInput.value = value;
    return true;
  };

  const validateAdditional = () => {
    clearFieldState([additionalInput, additionalError]);
    if (!additionalInput.value.trim()) return true;
    try {
      JSON.parse(additionalInput.value);
      return true;
    } catch (_error) {
      setFieldError(additionalInput, additionalError, 'JSON no válido. Verifica llaves y comillas.');
      return false;
    }
  };

  const handleBlurValidation = () => {
    clearFieldErrors(simulateForm);
    validateCard();
    validateMac();
    validateAdditional();
  };

  const handleMacInput = debounce(() => {
    clearFieldErrors(simulateForm);
    validateMac();
  }, 200);

  cardInput.addEventListener('blur', handleBlurValidation);
  macInput.addEventListener('blur', handleBlurValidation);
  macInput.addEventListener('input', handleMacInput);
  additionalInput.addEventListener('blur', handleBlurValidation);

  useNowBtn?.addEventListener('click', () => {
    const now = new Date();
    const formatted = now.toISOString().slice(0, 16);
    timestampInput.value = formatted;
    timestampError.hidden = true;
  });

  const init = async () => {
    setResultState('idle', {
      title: 'Aún no hay resultado',
      subtitle: 'Envía una lectura para ver la respuesta.'
    });
    rewriteNavLinks();
    const session = await ensureSession(true);
    if (!session) return;
    applyNavAccess(session);
  };

  init();
})();
