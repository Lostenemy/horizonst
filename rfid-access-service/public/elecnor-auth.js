(function () {
  const resolveBasePath = () => {
    const raw = window.__RFID_BASE_PATH__ || document.querySelector('base')?.getAttribute('href') || '';
    if (!raw || raw === '/') return '';
    const normalized = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    return normalized;
  };

  const BASE_PATH = resolveBasePath();

  const SESSION_CACHE_KEY = 'elecnorSession';

  const withBasePath = (path) => {
    if (!path) return BASE_PATH || '/';
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${BASE_PATH}${normalized}`;
  };

  const getCachedSession = () => {
    try {
      const stored = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_err) {
      return null;
    }
  };

  const cacheSession = (session) => {
    try {
      if (!session || !session.authenticated) {
        sessionStorage.removeItem(SESSION_CACHE_KEY);
        return;
      }
      sessionStorage.setItem(
        SESSION_CACHE_KEY,
        JSON.stringify({
          authenticated: Boolean(session.authenticated),
          username: session.username ?? null,
          role: session.role ?? null
        })
      );
    } catch (_err) {
      // Ignorar fallos de almacenamiento silenciosamente
    }
  };

  const rewriteNavLinks = (selectors = ['.breadcrumb a']) => {
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((anchor) => {
        const href = anchor.getAttribute('href');
        if (!href) return;
        anchor.setAttribute('href', withBasePath(href));
      });
    });
  };

  const applyNavAccess = (session) => {
    const role = session?.role || 'user';
    document.querySelectorAll('[data-requires-admin]').forEach((link) => {
      const hide = role !== 'admin';
      link.hidden = hide;
      link.setAttribute('aria-hidden', hide ? 'true' : 'false');
      link.setAttribute('tabindex', hide ? '-1' : '0');
      if (hide) {
        link.setAttribute('inert', '');
      } else {
        link.removeAttribute('inert');
      }
      link.classList.toggle('nav-link--hidden', hide);
    });
  };

  const primeNavAccess = () => {
    const cachedSession = getCachedSession();
    if (cachedSession) {
      applyNavAccess(cachedSession);
      return;
    }

    document.querySelectorAll('[data-requires-admin]').forEach((link) => {
      link.hidden = true;
      link.setAttribute('aria-hidden', 'true');
      link.setAttribute('tabindex', '-1');
      link.setAttribute('inert', '');
      link.classList.add('nav-link--hidden');
    });
  };

  const logout = async () => {
    try {
      await fetchJson(withBasePath('/api/logout'), { method: 'POST' });
    } catch (_error) {
      // Ignorar errores de redirección
    }

    cacheSession(null);
    window.location.href = withBasePath('/index.html');
  };

  const bindLogoutControl = () => {
    const control = document.querySelector('[data-logout]');
    if (!control || control.dataset.boundLogout === 'true') return;

    control.dataset.boundLogout = 'true';
    control.addEventListener('click', async (event) => {
      event.preventDefault();
      control.disabled = true;
      control.setAttribute('aria-busy', 'true');
      await logout();
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
      if (data) {
        error.payload = data;
      }
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
      cacheSession(session);

      if (!session.authenticated) {
        redirectToLogin();
        return null;
      }

      if (requireAdmin && session.role !== 'admin') {
        throw new Error('FORBIDDEN');
      }

      return session;
    } catch (_error) {
      cacheSession(null);
      redirectToLogin();
      return null;
    }
  };

  primeNavAccess();
  bindLogoutControl();
  document.addEventListener('DOMContentLoaded', bindLogoutControl);

  window.ElecnorAuth = {
    withBasePath,
    fetchJson,
    ensureSession,
    rewriteNavLinks,
    cacheSession,
    getCachedSession,
    applyNavAccess,
    logout,
    bindLogoutControl
  };
})();
