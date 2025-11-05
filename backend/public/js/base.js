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

  const logMissing = (action, id) => {
    if (!id) {
      return;
    }
    const stack = new Error(`domHelpers.${action} missing #${id}`).stack;
    if (console && typeof console.warn === 'function') {
      console.warn(`[domHelpers.${action}] Elemento no encontrado: #${id}`, { stack });
    }
  };

  const byId = (id) => {
    if (typeof id !== 'string' || !id) {
      return null;
    }
    return document.getElementById(id);
  };

  const setText = (id, text) => {
    const element = byId(id);
    if (element) {
      element.textContent = text;
    } else {
      logMissing('setText', id);
    }
    return element;
  };

  const setHTML = (id, html) => {
    const element = byId(id);
    if (element) {
      element.innerHTML = html;
    } else {
      logMissing('setHTML', id);
    }
    return element;
  };

  const addListener = (id, eventName, handler, options) => {
    const element = byId(id);
    if (element && typeof handler === 'function') {
      element.addEventListener(eventName, handler, options);
    } else if (!element) {
      logMissing(`addListener:${eventName}`, id);
    }
    return element;
  };

  window.domHelpers = {
    byId,
    setText,
    setHTML,
    addListener
  };

  if (!window.__GLOBAL_ERROR_LOGGER__) {
    window.__GLOBAL_ERROR_LOGGER__ = true;

    window.addEventListener('error', (event) => {
      if (!event) {
        return;
      }
      const details = {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error && event.error.stack
      };
      if (console && typeof console.groupCollapsed === 'function') {
        console.groupCollapsed('⚠️ Error global capturado');
        console.error(details.message);
        console.debug('Origen:', `${details.source || 'desconocido'}:${details.line || 0}:${details.column || 0}`);
        if (details.stack) {
          console.debug(details.stack);
        }
        console.groupEnd();
      } else {
        console.error('Error global capturado', details);
      }
    });

    window.addEventListener('unhandledrejection', (event) => {
      if (!event) {
        return;
      }
      const reason = event.reason;
      const message = reason && reason.message ? reason.message : 'Promesa rechazada sin manejar';
      const stack = reason && reason.stack ? reason.stack : undefined;
      if (console && typeof console.groupCollapsed === 'function') {
        console.groupCollapsed('⚠️ Promesa sin manejar');
        console.error(message);
        if (stack) {
          console.debug(stack);
        }
        console.groupEnd();
      } else {
        console.error('Promesa sin manejar', { message, stack });
      }
    });
  }

  window.apiFetch = (path, options = {}) => {
    const target = typeof path === 'string' ? join(window.API_BASE, path) : path;
    return fetch(target, options);
  };

  window.wsUrl = (path) => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}${join(BASE, path)}`;
  };
})();
