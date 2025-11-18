(function () {
  const resolveBasePath = () => {
    const raw = window.__RFID_BASE_PATH__ || document.querySelector('base')?.getAttribute('href') || '';
    if (!raw || raw === '/') return '';
    const normalized = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    return normalized;
  };

  const BASE_PATH = resolveBasePath();

  const withBasePath = (path) => {
    if (!path) return BASE_PATH || '/';
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${BASE_PATH}${normalized}`;
  };

  const rewriteNavLinks = (selectors = ['.topbar__nav a', '.breadcrumb a']) => {
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((anchor) => {
        const href = anchor.getAttribute('href');
        if (!href) return;
        anchor.setAttribute('href', withBasePath(href));
      });
    });
  };

  const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      ...options
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error('La respuesta del servidor no es JSON válido.');
      }
    }

    if (!response.ok) {
      const error = new Error(data?.error || `Error ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return data ?? {};
  };

  const redirectToLogin = () => {
    const next = window.location.pathname.replace(BASE_PATH, '').replace(/^\//, '');
    const search = next ? `?next=${encodeURIComponent(next)}` : '';
    window.location.href = withBasePath(`/index.html${search}`);
  };

  const ensureSession = async (requireAdmin = false) => {
    try {
      const session = await fetchJson(withBasePath('/api/session'));
      if (!session.authenticated) {
        redirectToLogin();
        return null;
      }
      if (requireAdmin && session.role !== 'admin') {
        throw new Error('FORBIDDEN');
      }
      return session;
    } catch (error) {
      redirectToLogin();
      return null;
    }
  };

  window.ElecnorAuth = { withBasePath, fetchJson, ensureSession, rewriteNavLinks };
})();
