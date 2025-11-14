const API_BASE = '/api';

const getToken = () => localStorage.getItem('authToken');

export const setToken = (token) => {
  localStorage.setItem('authToken', token);
};

export const clearSession = () => {
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
};

export const getCurrentUser = () => {
  const raw = localStorage.getItem('currentUser');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

export const setCurrentUser = (user) => {
  localStorage.setItem('currentUser', JSON.stringify(user));
};

const defaultHeaders = () => {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

const redirectToLogin = () => {
  window.location.href = '/';
};

const extractErrorMessage = async (response, fallback = 'Sesión no autorizada. Inicia sesión de nuevo.') => {
  if (!response || typeof response.text !== 'function') {
    return fallback;
  }
  try {
    const text = await response.text();
    if (!text) {
      return fallback;
    }
    const data = JSON.parse(text);
    return typeof data.message === 'string' && data.message ? data.message : fallback;
  } catch (_error) {
    return fallback;
  }
};

const handleUnauthorized = async (response) => {
  const hadSession = Boolean(getToken());
  const message = await extractErrorMessage(response);
  if (hadSession) {
    clearSession();
    redirectToLogin();
  }
  throw new Error(message);
};

export const apiGet = async (path) => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: defaultHeaders()
  });
  if (response.status === 401) {
    await handleUnauthorized(response);
  }
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json();
};

export const apiPost = async (path, body) => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify(body)
  });
  if (response.status === 401) {
    await handleUnauthorized(response);
  }
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Request failed with status ${response.status}`);
  }
  return response.json();
};

export const apiPut = async (path, body) => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: defaultHeaders(),
    body: JSON.stringify(body)
  });
  if (response.status === 401) {
    await handleUnauthorized(response);
  }
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Request failed with status ${response.status}`);
  }
  return response.json();
};

export const apiDelete = async (path) => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: defaultHeaders()
  });
  if (response.status === 401) {
    await handleUnauthorized(response);
  }
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Request failed with status ${response.status}`);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
};
