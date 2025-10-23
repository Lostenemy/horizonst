import { apiGet, apiPost, apiPut, clearSession, getCurrentUser } from './api.js';

document.getElementById('logoutLink').addEventListener('click', (event) => {
  event.preventDefault();
  clearSession();
  window.location.href = '/';
});

document.getElementById('year').textContent = new Date().getFullYear();

if (!getCurrentUser()) {
  window.location.href = '/';
}

const placeForm = document.getElementById('placeForm');
const placeMessage = document.getElementById('placeMessage');
const placesList = document.getElementById('placesList');

const createPlaceCard = (place) => {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h3>${place.name}</h3>
    <p>${place.description || 'Sin descripción'}</p>
    ${place.photo_url ? `<img src="${place.photo_url}" alt="${place.name}" style="width:100%;border-radius:8px;margin-bottom:1rem;" />` : ''}
    <div class="actions">
      <button data-id="${place.id}" class="edit-btn">Editar</button>
    </div>
  `;
  return card;
};

const loadPlaces = async () => {
  const places = await apiGet('/places');
  placesList.innerHTML = '';
  if (!places.length) {
    placesList.innerHTML = '<p>No hay lugares creados.</p>';
    return;
  }
  places.forEach((place) => {
    placesList.appendChild(createPlaceCard(place));
  });
};

placeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  placeMessage.style.display = 'none';
  const payload = {
    name: placeForm.placeName.value.trim(),
    description: placeForm.placeDescription.value.trim(),
    photoUrl: placeForm.placePhoto.value.trim()
  };
  try {
    await apiPost('/places', payload);
    placeMessage.textContent = 'Lugar creado correctamente';
    placeMessage.className = 'alert success';
    placeMessage.style.display = 'block';
    placeForm.reset();
    await loadPlaces();
  } catch (error) {
    placeMessage.textContent = error.message;
    placeMessage.className = 'alert error';
    placeMessage.style.display = 'block';
  }
});

placesList.addEventListener('click', async (event) => {
  if (!(event.target instanceof HTMLElement)) return;
  if (!event.target.classList.contains('edit-btn')) return;
  const id = Number(event.target.dataset.id);
  const newName = prompt('Nuevo nombre del lugar');
  if (!newName) return;
  try {
    await apiPut(`/places/${id}`, { name: newName });
    await loadPlaces();
  } catch (error) {
    alert(error.message);
  }
});

loadPlaces();
