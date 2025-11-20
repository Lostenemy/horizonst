(() => {
  const loadedSharedScripts = new Set(
    Array.from(document.querySelectorAll('script[data-shared-script][src]')).map((script) =>
      new URL(script.getAttribute('src'), window.location.href).toString()
    )
  );
  const loadedInlineShared = new Set(
    Array.from(document.querySelectorAll('script[data-shared-script]:not([src])')).map((script) =>
      (script.textContent || '').trim()
    )
  );

  const getBasePath = () => window.__RFID_BASE_PATH__ || '';

  const isInternal = (url) => {
    try {
      const target = new URL(url, window.location.href);
      return target.origin === window.location.origin && target.pathname.startsWith(getBasePath() || '/');
    } catch (_error) {
      return false;
    }
  };

  const setLoading = (active) => {
    document.body.classList.toggle('is-navigating', active);
  };

  const syncActiveNav = (view) => {
    if (!view) return;
    const links = document.querySelectorAll('[data-nav-view]');
    links.forEach((link) => {
      const isActive = link.dataset.navView === view;
      link.classList.toggle('nav-link--active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

  const executeScripts = (scripts) => {
    scripts.forEach((script) => {
      const cloned = document.createElement('script');

      if (script.src) {
        const src = new URL(script.getAttribute('src'), window.location.href).toString();
        const isShared = script.dataset.sharedScript !== undefined;
        if (isShared && loadedSharedScripts.has(src)) {
          return;
        }
        if (isShared) {
          loadedSharedScripts.add(src);
        }
        cloned.src = src;
        if (script.type) cloned.type = script.type;
        if (script.defer) cloned.defer = true;
        if (script.async) cloned.async = true;
      } else {
        const isSharedInline = script.dataset.sharedScript !== undefined;
        const signature = (script.textContent || '').trim();
        if (isSharedInline && signature) {
          if (loadedInlineShared.has(signature)) {
            return;
          }
          loadedInlineShared.add(signature);
        }
        cloned.textContent = script.textContent;
      }

      Object.entries(script.dataset || {}).forEach(([key, value]) => {
        cloned.dataset[key] = value;
      });

      document.body.appendChild(cloned);
    });
  };

  const applyPartial = (html) => {
    const template = document.createElement('template');
    template.innerHTML = html;

    const newMain = template.content.querySelector('main');
    const titleTag = template.content.querySelector('title');
    const scripts = Array.from(template.content.querySelectorAll('script'));

    if (!newMain) {
      return false;
    }

    const currentMain = document.getElementById('main-view') || document.querySelector('main');
    if (currentMain) {
      currentMain.replaceWith(newMain);
    } else {
      document.body.appendChild(newMain);
    }

    if (titleTag?.textContent) {
      document.title = titleTag.textContent;
    }

    syncActiveNav(newMain.dataset.view);
    executeScripts(scripts);
    window.ElecnorAuth?.applyNavAccess(window.ElecnorAuth?.getCachedSession?.());
    return true;
  };

  const fetchPartial = async (url) => {
    const response = await fetch(url, { headers: { 'X-Partial': '1' }, credentials: 'same-origin' });
    if (response.status === 401 || response.status === 403) {
      const next = url.replace(window.location.origin, '');
      window.location.href = window.ElecnorAuth?.withBasePath
        ? window.ElecnorAuth.withBasePath(`/index.html?next=${encodeURIComponent(next)}`)
        : url;
      return null;
    }

    if (!response.ok) {
      return null;
    }

    return response.text();
  };

  const navigate = async (href, { push = true } = {}) => {
    const url = href instanceof URL ? href.toString() : href;
    if (!isInternal(url)) {
      window.location.href = url;
      return;
    }

    setLoading(true);
    try {
      const html = await fetchPartial(url);
      if (!html) {
        window.location.href = url;
        return;
      }

      const applied = applyPartial(html);
      if (!applied) {
        window.location.href = url;
        return;
      }

      if (push) {
        window.history.pushState({}, '', url);
      }
    } catch (_error) {
      window.location.href = url;
    } finally {
      setLoading(false);
    }
  };

  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[data-router]');
    if (!anchor) return;
    if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    const url = new URL(href, window.location.href);
    if (!isInternal(url)) return;

    event.preventDefault();
    navigate(url.toString(), { push: true });
  });

  window.addEventListener('popstate', () => {
    navigate(window.location.href, { push: false });
  });

  syncActiveNav(document.getElementById('main-view')?.dataset.view);

  window.ElecnorRouter = {
    navigate,
    syncActiveNav
  };
})();
