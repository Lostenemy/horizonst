import { clearSession, getCurrentUser } from './api.js';

export const initAuthPage = () => {
  const helpers = window.domHelpers || {};
  const fallbackGet = (id) => (typeof id === 'string' && id ? document.getElementById(id) : null);
  const setText = typeof helpers.setText === 'function' ? helpers.setText : (id, text) => {
    const element = fallbackGet(id);
    if (element) {
      element.textContent = text;
    }
    return element;
  };
  const addListener = typeof helpers.addListener === 'function' ? helpers.addListener : (id, eventName, handler) => {
    const element = fallbackGet(id);
    if (element && typeof handler === 'function') {
      element.addEventListener(eventName, handler);
    }
    return element;
  };

  addListener('logoutLink', 'click', (event) => {
    event.preventDefault();
    clearSession();
    if (typeof window.joinBasePath === 'function') {
      window.location.href = window.joinBasePath('index.html');
    } else {
      window.location.href = 'index.html';
    }
  });

  setText('year', new Date().getFullYear().toString());

  const user = getCurrentUser();
  if (!user) {
    if (typeof window.joinBasePath === 'function') {
      window.location.href = window.joinBasePath('index.html');
    } else {
      window.location.href = 'index.html';
    }
    return { user: null, isAdmin: false };
  }

  if (document.body) {
    if (user.role === 'ADMIN') {
      document.body.classList.add('is-admin');
    } else {
      document.body.classList.remove('is-admin');
    }
  }

  return { user, isAdmin: user.role === 'ADMIN' };
};

const createOverlay = () => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  return overlay;
};

const closeOnEscape = (overlay) => {
  const handler = (event) => {
    if (event.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handler);
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
};

export const openFormModal = async ({ title, submitText = 'Guardar', fields, initialValues = {}, onSubmit }) => {
  return new Promise((resolve) => {
    const overlay = createOverlay();
    const modal = document.createElement('div');
    modal.className = 'modal-window';

    const header = document.createElement('div');
    header.className = 'modal-header';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'modal-close';
    closeButton.innerHTML = '&times;';
    header.appendChild(heading);
    header.appendChild(closeButton);

    const form = document.createElement('form');
    form.className = 'modal-form';

    const errorBox = document.createElement('div');
    errorBox.className = 'alert error';
    errorBox.style.display = 'none';
    form.appendChild(errorBox);

    fields.forEach((field) => {
      const wrapper = document.createElement('label');
      wrapper.className = 'modal-field';
      wrapper.textContent = field.label;

      let input;
      switch (field.type) {
        case 'textarea': {
          input = document.createElement('textarea');
          break;
        }
        case 'select': {
          input = document.createElement('select');
          const options = field.options || [];
          options.forEach((option) => {
            const opt = document.createElement('option');
            opt.value = option.value === null ? '' : String(option.value);
            opt.textContent = option.label;
            input.appendChild(opt);
          });
          break;
        }
        case 'file': {
          input = document.createElement('input');
          input.type = 'file';
          if (field.accept) {
            input.accept = field.accept;
          }
          break;
        }
        default: {
          input = document.createElement('input');
          input.type = field.type || 'text';
          break;
        }
      }

      input.name = field.name;
      if (field.placeholder) {
        input.placeholder = field.placeholder;
      }
      if (field.required) {
        input.required = true;
      }
      if (field.type !== 'file') {
        const value = initialValues[field.name];
        if (value !== undefined && value !== null) {
          input.value = String(value);
        }
      }
      if (field.type === 'textarea' && field.rows) {
        input.rows = field.rows;
      }
      if (field.readOnly) {
        input.readOnly = true;
      }

      wrapper.appendChild(input);
      form.appendChild(wrapper);
    });

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = submitText;

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancelar';
    cancelButton.className = 'secondary';

    actions.appendChild(submitButton);
    actions.appendChild(cancelButton);
    form.appendChild(actions);

    modal.appendChild(header);
    modal.appendChild(form);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const cleanup = closeOnEscape(overlay);

    const close = () => {
      cleanup();
      overlay.remove();
      resolve(null);
    };

    const handleCancel = () => {
      close();
    };

    cancelButton.addEventListener('click', handleCancel);
    closeButton.addEventListener('click', handleCancel);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        handleCancel();
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.style.display = 'none';
      const formData = new FormData(form);
      const values = {};
      fields.forEach((field) => {
        if (field.type === 'file') {
          values[field.name] = formData.get(field.name);
        } else {
          values[field.name] = formData.get(field.name);
        }
      });
      try {
        await onSubmit(values, close);
        close();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Operación no completada';
        errorBox.textContent = message;
        errorBox.style.display = 'block';
      }
    });
  });
};

export const confirmAction = ({ title, message, confirmText = 'Aceptar', cancelText = 'Cancelar' }) => {
  return new Promise((resolve) => {
    const overlay = createOverlay();
    const modal = document.createElement('div');
    modal.className = 'modal-window';

    const header = document.createElement('div');
    header.className = 'modal-header';
    const heading = document.createElement('h2');
    heading.textContent = title;
    header.appendChild(heading);

    const body = document.createElement('div');
    body.className = 'modal-body';
    body.innerHTML = `<p>${message}</p>`;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = confirmText;

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = cancelText;
    cancelButton.className = 'secondary';

    actions.appendChild(confirmButton);
    actions.appendChild(cancelButton);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const cleanup = closeOnEscape(overlay);

    const close = (result) => {
      cleanup();
      overlay.remove();
      resolve(result);
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close(false);
      }
    });

    cancelButton.addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(true));
  });
};

export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    if (!(file instanceof File)) {
      reject(new Error('Archivo no válido'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      } else {
        reject(new Error('No se pudo leer el archivo'));
      }
    };
    reader.onerror = () => {
      reject(new Error('No se pudo leer el archivo'));
    };
    reader.readAsDataURL(file);
  });
};
