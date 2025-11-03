(function () {
  const resolveBasePath = () => {
    if (typeof window.__BASE_PATH__ === 'string' && window.__BASE_PATH__) {
      return window.__BASE_PATH__;
    }
    const baseTag = document.querySelector('base');
    if (baseTag && baseTag.href) {
      try {
        const url = new URL(baseTag.href, window.location.href);
        const pathname = url.pathname || '/';
        return pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
      } catch (_error) {
        // ignore and fallback below
      }
    }
    const { pathname } = window.location;
    if (pathname === '/' || pathname === '') {
      return '/';
    }
    if (pathname.endsWith('/')) {
      return pathname.replace(/\/+$/, '') || '/';
    }
    const withoutFile = pathname.replace(/\/+[^\/]*$/, '');
    return withoutFile || '/';
  };

  const rawBase = resolveBasePath();
  const normalizedBase = rawBase === '/' ? '/' : rawBase.replace(/\/+$/, '');
  window.__BASE_PATH__ = normalizedBase === '' ? '/' : normalizedBase;
  const BASE = normalizedBase === '/' ? '' : normalizedBase;

  function join(...parts) {
    return parts
      .filter((part) => part !== undefined && part !== null)
      .map((part, index) => {
        const value = String(part);
        if (index === 0) {
          return value.replace(/\/+$/, '');
        }
        return value.replace(/^\/+|\/+$/g, '');
      })
      .join('/')
      .replace(/^(?=[^/])/, '/');
  }

  window.joinBasePath = (...segments) => join(BASE, ...segments);
  window.API_BASE = join(BASE, 'api');

  window.apiFetch = (path, options = {}) => {
    const target = typeof path === 'string' ? join(window.API_BASE, path) : path;
    return fetch(target, options);
  };

  window.wsUrl = (path) => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}${join(BASE, path)}`;
  };
})();
