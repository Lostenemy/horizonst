(() => {
  const { fetchJson, withBasePath, ensureSession, rewriteNavLinks } = window.ElecnorAuth;

  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');

  let historyData = [];

  const renderHistory = () => {
    historyList.innerHTML = '';

    if (!historyData.length) {
      historyEmpty.classList.remove('hidden');
      return;
    }

    historyEmpty.classList.add('hidden');

    historyData.forEach((event) => {
      const item = document.createElement('li');
      item.className = 'history-item';

      const header = document.createElement('header');
      const decision = document.createElement('span');
      decision.className = `decision ${event.decision === 'GRANTED' ? 'granted' : 'denied'}`;
      decision.textContent = event.decision === 'GRANTED' ? 'ACCESO CONCEDIDO' : 'ACCESO DENEGADO';

      const origin = document.createElement('span');
      origin.className = 'muted';
      origin.textContent = `${new Date(event.timestamp).toLocaleString()} · Origen: ${
        event.source === 'web' ? 'interfaz web' : 'MQTT'
      }`;

      header.append(decision, origin);

      const summary = document.createElement('div');
      summary.className = 'muted';
      summary.textContent = `Tarjeta ${event.cardId} · Lector ${event.mac} · DNI ${
        event.dni ?? 'no asignado'
      }${event.reason ? ` · Motivo ${event.reason}` : ''}`;

      const publicationsTitle = document.createElement('strong');
      publicationsTitle.textContent = 'Publicaciones MQTT:';

      const publications = document.createElement('ul');
      publications.className = 'publications';

      event.publications.forEach((pub) => {
        const li = document.createElement('li');
        li.textContent = `${pub.topic} → ${pub.payload}`;
        publications.appendChild(li);
      });

      item.append(header, summary, publicationsTitle, publications);
      historyList.appendChild(item);
    });
  };

  const loadHistory = async () => {
    try {
      const data = await fetchJson(withBasePath('/api/history'));
      historyData = Array.isArray(data?.history) ? data.history : [];
      renderHistory();
    } catch (error) {
      historyEmpty.textContent = 'No se pudo cargar el histórico.';
      historyEmpty.classList.remove('hidden');
    }
  };

  const init = async () => {
    rewriteNavLinks();
    const session = await ensureSession();
    if (!session) return;
    await loadHistory();
  };

  init();
})();
