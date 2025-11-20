(() => {
  const ensureToastStack = () => {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  };

  const showToast = (message, type = 'success') => {
    if (!message) return;
    const stack = ensureToastStack();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    stack.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast--visible'));

    const timeout = window.setTimeout(() => {
      toast.classList.remove('toast--visible');
      toast.classList.add('toast--leaving');
      window.setTimeout(() => toast.remove(), 250);
    }, 3200);

    toast.addEventListener('click', () => {
      window.clearTimeout(timeout);
      toast.classList.remove('toast--visible');
      toast.classList.add('toast--leaving');
      window.setTimeout(() => toast.remove(), 200);
    });
  };

  const debounce = (func, wait = 300) => {
    let timeout;
    return (...args) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => func.apply(null, args), wait);
    };
  };

  const createConfirmModal = ({ title, message, confirmLabel, cancelLabel, tone }) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal';
    overlay.innerHTML = `
      <div class="confirm-modal__backdrop" data-confirm-cancel></div>
      <div class="confirm-modal__panel" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <div class="confirm-modal__header">
          <h3 id="confirm-modal-title">${title}</h3>
          <p>${message}</p>
        </div>
        <div class="confirm-modal__actions">
          <button type="button" class="cta cta--ghost" data-confirm-cancel>${cancelLabel}</button>
          <button type="button" class="cta ${tone === 'danger' ? 'cta--danger' : 'cta--primary'}" data-confirm-ok>${confirmLabel}</button>
        </div>
      </div>`;
    return overlay;
  };

  const confirmAction = ({
    title = '¿Confirmar acción?',
    message = 'Esta acción no se puede deshacer.',
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    tone = 'danger'
  } = {}) =>
    new Promise((resolve) => {
      const restoreModal = !document.body.classList.contains('modal-open');
      if (restoreModal) {
        document.body.classList.add('modal-open');
      }
      const modal = createConfirmModal({ title, message, confirmLabel, cancelLabel, tone });
      document.body.appendChild(modal);
      const confirmBtn = modal.querySelector('[data-confirm-ok]');
      const cancelBtns = modal.querySelectorAll('[data-confirm-cancel]');

      let settled = false;
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        modal.classList.add('confirm-modal--closing');
        window.setTimeout(() => {
          modal.remove();
          if (restoreModal) {
            document.body.classList.remove('modal-open');
          }
          document.removeEventListener('keydown', handleKeydown);
          resolve(result);
        }, 200);
      };

      confirmBtn.addEventListener('click', () => cleanup(true));
      cancelBtns.forEach((btn) => btn.addEventListener('click', () => cleanup(false)));

      const handleKeydown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup(false);
        } else if (event.key === 'Enter' && document.activeElement === confirmBtn) {
          event.preventDefault();
          cleanup(true);
        }
      };

      document.addEventListener('keydown', handleKeydown);
      requestAnimationFrame(() => confirmBtn.focus());
    });

  const clearFieldErrors = (form) => {
    if (!form) return;
    form.querySelectorAll('.error-message').forEach((message) => message.remove());
    form
      .querySelectorAll('.error')
      .forEach((field) => {
        field.classList.remove('error');
        field.removeAttribute('aria-invalid');
      });
  };

  const showFieldError = (field, message) => {
    if (!field) return;
    field.classList.add('error');
    field.setAttribute('aria-invalid', 'true');
    const wrapper = field.closest('.form-field') || field.parentElement;
    if (!wrapper) return;
    const error = document.createElement('div');
    error.className = 'error-message';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    wrapper.appendChild(error);
  };

  window.ElecnorUI = {
    showToast,
    debounce,
    confirmAction,
    clearFieldErrors,
    showFieldError
  };
})();
