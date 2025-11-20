(function () {
  const basePath = window.__RFID_BASE_PATH__ || '';
  const jsonHeaders = { 'Content-Type': 'application/json' };

  let users = [];
  let cards = [];
  let initialized = false;

  const handleResponse = async (response) => {
    if (response.status === 204) {
      return null;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error || 'REQUEST_FAILED';
      throw new Error(message);
    }
    return data;
  };

  const request = async (path, options = {}) => {
    const response = await fetch(`${basePath}${path}`, { credentials: 'same-origin', ...options });
    return handleResponse(response);
  };

  const refreshUsers = async () => {
    const data = await request('/api/workers');
    users = data?.workers ?? [];
    return users;
  };

  const refreshCards = async () => {
    const data = await request('/api/cards');
    cards = data?.cards ?? [];
    return cards;
  };

  const init = async () => {
    if (initialized) return;
    await Promise.all([refreshUsers(), refreshCards()]);
    initialized = true;
  };

  const upsertUser = async (user) => {
    const exists = users.some((item) => item.dni === user.dni);
    const endpoint = exists ? `/api/workers/${encodeURIComponent(user.dni)}` : '/api/workers';
    const data = await request(endpoint, {
      method: exists ? 'PATCH' : 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(user)
    });
    const worker = data?.worker;
    if (worker) {
      users = users.filter((item) => item.dni !== worker.dni).concat(worker);
    }
    return worker;
  };

  const deleteUser = async (dni) => {
    await request(`/api/workers/${encodeURIComponent(dni)}`, { method: 'DELETE' });
    users = users.filter((user) => user.dni !== dni);
    cards = cards.map((card) => (card.dni === dni ? { ...card, estado: 'bloqueada', notas: 'Usuario eliminado' } : card));
  };

  const upsertCard = async (card) => {
    const data = await request('/api/cards', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(card)
    });
    const saved = data?.card;
    if (saved) {
      cards = cards.filter((item) => item.idTarjeta !== saved.idTarjeta).concat(saved);
    }
    return saved;
  };

  const toggleCardState = async (idTarjeta, estado) => {
    const data = await request(`/api/cards/${encodeURIComponent(idTarjeta)}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ estado })
    });
    const saved = data?.card;
    if (saved) {
      cards = cards.filter((item) => item.idTarjeta !== saved.idTarjeta).concat(saved);
    }
    return saved;
  };

  const deleteCard = async (idTarjeta) => {
    await request(`/api/cards/${encodeURIComponent(idTarjeta)}`, { method: 'DELETE' });
    cards = cards.filter((card) => card.idTarjeta !== idTarjeta);
  };

  const getUserByDni = (dni) => users.find((user) => user.dni === dni);

  window.ElecnorData = {
    init,
    refreshUsers,
    refreshCards,
    getUsers: () => users,
    getCards: () => cards,
    upsertUser,
    deleteUser,
    upsertCard,
    deleteCard,
    toggleCardState,
    getUserByDni
  };
})();
