export const errorText = (error) => error?.status === 403
  ? 'Acceso denegado.' : error?.name === 'AbortError'
    ? 'La consulta excedió el tiempo de espera.' : 'No se pudo completar la consulta.';

// Un estado de error nunca se presenta como un vacío válido.
export function createLoadState({ anchor, empty, clear = () => {}, label, onRetry }) {
  const panel = document.createElement('div');
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  const text = document.createElement('span');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Reintentar';
  retry.addEventListener('click', () => onRetry());
  panel.append(text, retry);
  anchor.before(panel);
  return (state, error) => {
    panel.dataset.state = state;
    retry.hidden = !['error', 'denied'].includes(state);
    if (empty) empty.style.display = state === 'empty' ? 'block' : 'none';
    if (state !== 'ready' && state !== 'empty') clear();
    text.textContent = state === 'loading' ? `Cargando ${label}…`
      : state === 'error' || state === 'denied' ? `${label}: ${errorText(error)}` : '';
  };
}

export function createMetadataLoader({ anchor, resources, onChange }) {
  const ready = new Set();
  let running = false;
  const panel = document.createElement('div');
  panel.setAttribute('role', 'status');
  const text = document.createElement('span');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Reintentar metadatos';
  retry.addEventListener('click', () => run());
  panel.append(text, retry);
  anchor.before(panel);
  const run = async () => {
    if (running) return;
    running = true;
    retry.hidden = true;
    text.textContent = 'Cargando metadatos; las acciones que los requieren están deshabilitadas.';
    onChange();
    const failures = [];
    await Promise.all(resources.map(async ({ key, load, apply }) => {
      if (ready.has(key)) return;
      try { apply(await load()); ready.add(key); }
      catch (error) { failures.push(`${key}: ${errorText(error)}`); }
      onChange();
    }));
    running = false;
    retry.hidden = failures.length === 0;
    text.textContent = failures.length ? `${failures.join(' ')} Las acciones dependientes siguen deshabilitadas.` : '';
    onChange();
  };
  return { run, ready: (key) => ready.has(key) };
}
