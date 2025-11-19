(() => {
  const { withBasePath, fetchJson, ensureSession, rewriteNavLinks } = window.ElecnorAuth;

  const simulateForm = document.getElementById('simulate-form');
  const simulateError = document.getElementById('simulate-error');
  const simulateResult = document.getElementById('simulate-result');
  const cardInput = document.getElementById('simulate-card-id');
  const macInput = document.getElementById('simulate-mac');
  const timestampInput = document.getElementById('simulate-timestamp');
  const additionalInput = document.getElementById('simulate-additional');

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

  const showResult = (event) => {
    simulateResult.classList.remove('hidden', 'success', 'error');
    simulateResult.classList.add(event.decision === 'GRANTED' ? 'success' : 'error');
    simulateResult.innerHTML = '';

    const title = document.createElement('strong');
    title.textContent = event.decision === 'GRANTED' ? 'ACCESO CONCEDIDO' : 'ACCESO DENEGADO';

    const cardLine = document.createElement('div');
    cardLine.textContent = `Tarjeta ${event.cardId} · MAC ${event.mac}`;

    const dniLine = document.createElement('div');
    dniLine.textContent = `DNI asociado: ${event.dni ?? 'no asignado'}`;

    const reasonLine = document.createElement('div');
    reasonLine.textContent = event.reason ? `Motivo: ${event.reason}` : 'Motivo no especificado';

    const pubsLine = document.createElement('div');
    pubsLine.innerHTML = `<span class="eyebrow">Publicaciones MQTT</span><ul class="publications">${event.publications
      .map((pub) => `<li>${pub.topic} → ${pub.payload}</li>`)
      .join('')}</ul>`;

    simulateResult.append(title, cardLine, dniLine, reasonLine, pubsLine);
  };

  simulateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    simulateError.hidden = true;
    simulateError.textContent = '';

    const cardId = cardInput.value.trim();
    const mac = macInput.value.trim();

    if (!cardId || !mac) {
      simulateError.textContent = 'Debe indicar el ID de la tarjeta y la MAC del lector.';
      simulateError.hidden = false;
      return;
    }

    let timestamp;
    if (timestampInput.value) {
      const parsed = new Date(timestampInput.value);
      if (Number.isNaN(parsed.getTime())) {
        simulateError.textContent = 'La fecha introducida no es válida.';
        simulateError.hidden = false;
        return;
      }
      timestamp = parsed.toISOString();
    }

    let additional;
    try {
      additional = parseJsonSafely(additionalInput.value);
    } catch (error) {
      simulateError.textContent = error.message;
      simulateError.hidden = false;
      return;
    }

    try {
      const result = await fetchJson(withBasePath('/api/simulate'), {
        method: 'POST',
        body: JSON.stringify({ cardId, mac, timestamp, additional })
      });

      showResult(result);
    } catch (error) {
      simulateResult.classList.add('hidden');
      simulateResult.innerHTML = '';
      simulateError.textContent =
        error instanceof Error ? error.message : 'No se pudo ejecutar la simulación.';
      simulateError.hidden = false;
    }
  });

  const init = async () => {
    rewriteNavLinks();
    const session = await ensureSession();
    if (!session) return;
  };

  init();
})();
