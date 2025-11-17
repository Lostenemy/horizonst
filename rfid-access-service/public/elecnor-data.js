(function () {
  const STORAGE_KEYS = {
    users: 'elecnorUsers',
    cards: 'elecnorCards'
  };

  const sampleUsers = [
    {
      dni: '12345678A',
      nombre: 'María',
      apellidos: 'García Ruiz',
      empresa: 'Instalaciones Norte S.L.',
      cif: 'B12345678',
      centro: 'C-VAL-001',
      email: 'maria.garcia@example.com',
      activo: true,
      creadoEn: new Date().toISOString()
    },
    {
      dni: '98765432B',
      nombre: 'Diego',
      apellidos: 'Martín Ortega',
      empresa: 'Elecnor Proyectos',
      cif: 'A87654321',
      centro: 'C-MAD-023',
      email: 'diego.martin@example.com',
      activo: true,
      creadoEn: new Date().toISOString()
    },
    {
      dni: '44556677C',
      nombre: 'Laura',
      apellidos: 'Santos Pérez',
      empresa: 'Logística Sur',
      cif: 'B19283746',
      centro: 'C-BCN-012',
      email: 'laura.santos@example.com',
      activo: false,
      creadoEn: new Date().toISOString()
    }
  ];

  const sampleCards = [
    {
      idTarjeta: 'RFID-0001',
      dni: '12345678A',
      centro: 'C-VAL-001',
      estado: 'activa',
      notas: 'Acceso a nave principal',
      asignadaEn: new Date().toISOString()
    },
    {
      idTarjeta: 'RFID-0002',
      dni: '98765432B',
      centro: 'C-MAD-023',
      estado: 'activa',
      notas: 'Autorización completa',
      asignadaEn: new Date().toISOString()
    }
  ];

  const loadCollection = (key, defaults) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        localStorage.setItem(key, JSON.stringify(defaults));
        return [...defaults];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('Formato incorrecto');
      }
      return parsed;
    } catch (error) {
      console.warn(`No se pudo leer ${key} desde localStorage`, error);
      localStorage.setItem(key, JSON.stringify(defaults));
      return [...defaults];
    }
  };

  const persistCollection = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  };

  const getUsers = () => loadCollection(STORAGE_KEYS.users, sampleUsers);
  const getCards = () => loadCollection(STORAGE_KEYS.cards, sampleCards);

  const upsertUser = (user) => {
    const users = getUsers();
    const existingIndex = users.findIndex((item) => item.dni === user.dni);
    const enriched = {
      ...user,
      creadoEn: user.creadoEn || new Date().toISOString()
    };

    if (existingIndex >= 0) {
      users[existingIndex] = { ...users[existingIndex], ...enriched };
    } else {
      users.push(enriched);
    }

    persistCollection(STORAGE_KEYS.users, users);
    return enriched;
  };

  const deleteUser = (dni) => {
    const users = getUsers();
    const filtered = users.filter((user) => user.dni !== dni);
    persistCollection(STORAGE_KEYS.users, filtered);

    const cards = getCards().map((card) =>
      card.dni === dni ? { ...card, estado: 'bloqueada', notas: 'Usuario eliminado' } : card
    );
    persistCollection(STORAGE_KEYS.cards, cards);
  };

  const upsertCard = (card) => {
    const cards = getCards();
    const existingIndex = cards.findIndex((item) => item.idTarjeta === card.idTarjeta);
    const enriched = {
      ...card,
      asignadaEn: card.asignadaEn || new Date().toISOString()
    };

    if (existingIndex >= 0) {
      cards[existingIndex] = { ...cards[existingIndex], ...enriched };
    } else {
      cards.push(enriched);
    }

    persistCollection(STORAGE_KEYS.cards, cards);
    return enriched;
  };

  const deleteCard = (idTarjeta) => {
    const cards = getCards().filter((card) => card.idTarjeta !== idTarjeta);
    persistCollection(STORAGE_KEYS.cards, cards);
  };

  const toggleCardState = (idTarjeta, estado) => {
    const cards = getCards().map((card) => (card.idTarjeta === idTarjeta ? { ...card, estado } : card));
    persistCollection(STORAGE_KEYS.cards, cards);
  };

  const getUserByDni = (dni) => getUsers().find((user) => user.dni === dni);

  window.ElecnorData = {
    getUsers,
    getCards,
    upsertUser,
    deleteUser,
    upsertCard,
    deleteCard,
    toggleCardState,
    getUserByDni
  };
})();
