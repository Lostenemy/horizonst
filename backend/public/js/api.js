const API_BASE = window.API_BASE || '/api';

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
  if (typeof window.joinBasePath === 'function') {
    window.location.href = window.joinBasePath('index.html');
    return;
  }
  window.location.href = 'index.html';
};

const callApi = (path, options) => {
  if (typeof window.apiFetch === 'function') {
    return window.apiFetch(path, options);
  }
  const url = typeof path === 'string' ? `${API_BASE}${path}` : path;
  return fetch(url, options);
};

export const apiGet = async (path) => {
  const response = await callApi(path, {
    headers: defaultHeaders()
  });
  if (response.status === 401) {
    clearSession();
    redirectToLogin();
    return;
  }
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json();
};

export const apiPost = async (path, body) => {
  const response = await callApi(path, {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify(body)
  });
  if (response.status === 401) {
    clearSession();
    redirectToLogin();
    return;
  }
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Request failed with status ${response.status}`);
  }
  return response.json();
};

export const apiPut = async (path, body) => {
  const response = await callApi(path, {
    method: 'PUT',
    headers: defaultHeaders(),
    body: JSON.stringify(body)
  });
  if (response.status === 401) {
    clearSession();
    redirectToLogin();
    return;
  }
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Request failed with status ${response.status}`);
  }
  return response.json();
};

export const apiDelete = async (path) => {
  const response = await callApi(path, {
    method: 'DELETE',
    headers: defaultHeaders()
  });
  if (response.status === 401) {
    clearSession();
    redirectToLogin();
    return;
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
