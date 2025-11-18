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
    return `${BASE_PATH}${normalized}` || normalized;
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
      const err = new Error(data?.error || `Error ${response.status}`);
      err.status = response.status;
      throw err;
    }

    return data ?? {};
  };

  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');

  const nextPage = new URLSearchParams(window.location.search).get('next');

  const redirectTo = (target) => {
    window.location.href = withBasePath(target.startsWith('/') ? target : `/${target}`);
  };

  const rewriteNavLinks = () => {
    document.querySelectorAll('.topbar__nav a, .breadcrumb a').forEach((anchor) => {
      const href = anchor.getAttribute('href');
      if (!href) return;
      anchor.setAttribute('href', withBasePath(href));
    });
  };

  const handleAuthenticated = () => {
    if (nextPage) {
      redirectTo(nextPage);
    } else {
      redirectTo('/elecnor-tarjetas.html');
    }
  };

  const checkSession = async () => {
    try {
      const session = await fetchJson(withBasePath('/api/session'));
      if (session?.authenticated) {
        window.ElecnorAuth?.cacheSession?.(session);
        handleAuthenticated();
      }
    } catch (error) {
      console.warn('No se pudo validar la sesión', error);
    }
  };

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    loginError.textContent = '';

    try {
      const session = await fetchJson(withBasePath('/api/login'), {
        method: 'POST',
        body: JSON.stringify({
          username: usernameInput.value.trim(),
          password: passwordInput.value
        })
      });
      window.ElecnorAuth?.cacheSession?.(session);
      handleAuthenticated();
    } catch (error) {
      loginError.textContent =
        error instanceof Error ? error.message : 'No se pudo iniciar sesión. Compruebe las credenciales.';
      loginError.hidden = false;
    }
  });

  rewriteNavLinks();
  checkSession();
})();
