(function () {
  const RAW_BASE_PATH = '__BASE_PATH__';
  const BASE_PATH = !RAW_BASE_PATH || RAW_BASE_PATH === '/' ? '' : RAW_BASE_PATH;

  const withBasePath = (path) => {
    if (!path) return BASE_PATH || '/';
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${BASE_PATH}${normalized}`;
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

  window.ElecnorAuth = { withBasePath, fetchJson, ensureSession };
})();
