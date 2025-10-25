import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction, fileToBase64 } from './ui.js';

const { user } = initAuthPage();
if (!user) {
  throw new Error('Usuario no autenticado');
}

const placeForm = document.getElementById('placeForm');
const placeMessage = document.getElementById('placeMessage');
const placesList = document.getElementById('placesList');

let places = [];

const loadPlaces = async () => {
  places = await apiGet('/places');
  renderPlaces();
};

const handleCreatePlace = async (event) => {
  event.preventDefault();
  placeMessage.style.display = 'none';
  const payload = {
    name: placeForm.placeName.value.trim(),
    description: placeForm.placeDescription.value.trim(),
    photoUrl: placeForm.placePhoto.value.trim()
  };
  if (!payload.name) {
    placeMessage.textContent = 'El nombre es obligatorio';
    placeMessage.className = 'alert error';
    placeMessage.style.display = 'block';
    return;
  }
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
};

const handleEditPlace = async (place) => {
  await openFormModal({
    title: `Editar lugar ${place.name}`,
    submitText: 'Guardar cambios',
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      { name: 'description', label: 'Descripción', type: 'textarea', rows: 3 },
      { name: 'photoUrl', label: 'URL de foto', type: 'text', placeholder: 'https://' }
    ],
    initialValues: {
      name: place.name,
      description: place.description || '',
      photoUrl: place.photo_url || ''
    },
    onSubmit: async (values) => {
      const payload = {
        name: values.name ? String(values.name).trim() : '',
        description: values.description ? String(values.description).trim() : '',
        photoUrl: values.photoUrl ? String(values.photoUrl).trim() : ''
      };
      if (!payload.name) {
        throw new Error('El nombre es obligatorio');
      }
      await apiPut(`/places/${place.id}`, payload);
      await loadPlaces();
    }
  });
};

const handleUploadPhoto = async (place) => {
  await openFormModal({
    title: `Subir imagen para ${place.name}`,
    submitText: 'Subir',
    fields: [
      { name: 'title', label: 'Título', type: 'text', placeholder: 'Descripción de la imagen' },
      { name: 'image', label: 'Archivo', type: 'file', required: true, accept: 'image/*' }
    ],
    initialValues: {},
    onSubmit: async (values) => {
      const file = values.image;
      if (!(file instanceof File)) {
        throw new Error('Selecciona un archivo de imagen');
      }
      const imageData = await fileToBase64(file);
      await apiPost(`/places/${place.id}/photos`, {
        title: values.title ? String(values.title).trim() || file.name : file.name,
        imageData
      });
    }
  });
};

const handleDeletePlace = async (place) => {
  const confirmed = await confirmAction({
    title: 'Eliminar lugar',
    message: `¿Seguro que quieres eliminar <strong>${place.name}</strong>?`,
    confirmText: 'Eliminar'
  });
  if (!confirmed) return;
  await apiDelete(`/places/${place.id}`);
  await loadPlaces();
};

const renderPlaces = () => {
  placesList.innerHTML = '';
  if (!places.length) {
    placesList.innerHTML = '<p>No hay lugares creados.</p>';
    return;
  }

  places.forEach((place) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${place.name}</h3>
      <p>${place.description || 'Sin descripción'}</p>
      ${place.photo_url ? `<img src="${place.photo_url}" alt="${place.name}" style="width:100%;border-radius:8px;margin-bottom:1rem;" />` : ''}
      <div class="actions">
        <button data-id="${place.id}" data-action="edit">Editar</button>
        <button data-id="${place.id}" data-action="upload">Subir imagen</button>
        <button data-id="${place.id}" data-action="delete" class="secondary">Eliminar</button>
      </div>
    `;
    placesList.appendChild(card);
  });
};

placeForm.addEventListener('submit', handleCreatePlace);

placesList.addEventListener('click', async (event) => {
  if (!(event.target instanceof HTMLElement)) return;
  const action = event.target.dataset.action;
  if (!action) return;
  const id = Number(event.target.dataset.id);
  const place = places.find((item) => item.id === id);
  if (!place) return;

  if (action === 'edit') {
    await handleEditPlace(place);
  } else if (action === 'upload') {
    await handleUploadPhoto(place);
  } else if (action === 'delete') {
    await handleDeletePlace(place);
  }
});

loadPlaces();
