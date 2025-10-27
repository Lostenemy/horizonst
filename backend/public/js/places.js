import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction, fileToBase64 } from './ui.js';

const { user } = initAuthPage();
if (!user) {
  throw new Error('Usuario no autenticado');
}

const placesList = document.getElementById('placesList');
const createPlaceButton = document.getElementById('createPlaceButton');

let places = [];
let placePhotoLibrary = [];

const formatPhotoLabel = (photo) => {
  if (photo.title) {
    return photo.title;
  }
  if (photo.created_at) {
    const date = new Date(photo.created_at);
    if (!Number.isNaN(date.getTime())) {
      return `Imagen subida ${date.toLocaleString()}`;
    }
  }
  return `Imagen #${photo.id}`;
};

const extractBase64 = (dataUrl) => {
  if (typeof dataUrl !== 'string') {
    return '';
  }
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
};

const refreshPlaceLibrary = async () => {
  try {
    placePhotoLibrary = await apiGet('/places/photos/library');
  } catch (error) {
    console.error('No se pudo cargar la biblioteca de imágenes de lugares', error);
    placePhotoLibrary = [];
  }
};

const uploadPlacePhoto = async (placeId, file, title) => {
  const imageData = await fileToBase64(file);
  return apiPost(`/places/${placeId}/photos`, {
    title: title || file.name,
    imageData,
    mimeType: file.type || 'image/jpeg'
  });
};

const loadPlaces = async () => {
  places = await apiGet('/places');
  renderPlaces();
};

const openCreatePlaceModal = async () => {
  await refreshPlaceLibrary();
  const photoOptions = [
    { value: '', label: 'Sin imagen' },
    ...placePhotoLibrary.map((photo) => ({ value: String(photo.id), label: formatPhotoLabel(photo) }))
  ];

  await openFormModal({
    title: 'Nuevo lugar',
    submitText: 'Crear',
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      { name: 'description', label: 'Descripción', type: 'textarea', rows: 3 },
      { name: 'photoChoice', label: 'Seleccionar imagen existente', type: 'select', options: photoOptions },
      { name: 'newPhotoTitle', label: 'Título para nueva imagen', type: 'text', placeholder: 'Descripción (opcional)' },
      { name: 'newPhoto', label: 'Subir nueva imagen', type: 'file', accept: 'image/*' }
    ],
    initialValues: {},
    onSubmit: async (values) => {
      const nameValue = values.name ? String(values.name).trim() : '';
      if (!nameValue) {
        throw new Error('El nombre es obligatorio');
      }
      const descriptionValue = values.description ? String(values.description).trim() : '';
      const selectedValue = values.photoChoice ? String(values.photoChoice) : '';
      const selectedPhoto = selectedValue
        ? placePhotoLibrary.find((photo) => String(photo.id) === selectedValue)
        : null;

      const place = await apiPost('/places', {
        name: nameValue,
        description: descriptionValue
      });

      const newPhotoFile = values.newPhoto;
      if (newPhotoFile instanceof File && newPhotoFile.size > 0) {
        await uploadPlacePhoto(
          place.id,
          newPhotoFile,
          values.newPhotoTitle ? String(values.newPhotoTitle).trim() || newPhotoFile.name : newPhotoFile.name
        );
      } else if (selectedPhoto) {
        const base64 = extractBase64(selectedPhoto.image_url);
        if (base64) {
          await apiPost(`/places/${place.id}/photos`, {
            title: selectedPhoto.title ?? null,
            imageData: base64,
            mimeType: selectedPhoto.mime_type || 'image/jpeg'
          });
        }
      }

      await Promise.all([loadPlaces(), refreshPlaceLibrary()]);
    }
  });
};

const handleEditPlace = async (place) => {
  const photos = await apiGet(`/places/${place.id}/photos`);
  const currentPhoto = place.photo_url
    ? photos.find((photo) => photo.image_url === place.photo_url)
    : null;
  const photoOptions = [
    { value: '', label: 'Sin imagen' },
    ...photos.map((photo) => ({ value: String(photo.id), label: formatPhotoLabel(photo) }))
  ];

  await openFormModal({
    title: `Editar lugar ${place.name}`,
    submitText: 'Guardar cambios',
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      { name: 'description', label: 'Descripción', type: 'textarea', rows: 3 },
      { name: 'photoChoice', label: 'Seleccionar imagen existente', type: 'select', options: photoOptions },
      { name: 'newPhotoTitle', label: 'Título para nueva imagen', type: 'text', placeholder: 'Descripción (opcional)' },
      { name: 'newPhoto', label: 'Subir nueva imagen', type: 'file', accept: 'image/*' }
    ],
    initialValues: {
      name: place.name,
      description: place.description || '',
      photoChoice: currentPhoto ? String(currentPhoto.id) : ''
    },
    onSubmit: async (values) => {
      const nameValue = values.name ? String(values.name).trim() : '';
      if (!nameValue) {
        throw new Error('El nombre es obligatorio');
      }
      const descriptionValue = values.description ? String(values.description).trim() : '';

      await apiPut(`/places/${place.id}`, {
        name: nameValue,
        description: descriptionValue
      });

      const newPhotoFile = values.newPhoto;
      if (newPhotoFile instanceof File && newPhotoFile.size > 0) {
        await uploadPlacePhoto(
          place.id,
          newPhotoFile,
          values.newPhotoTitle ? String(values.newPhotoTitle).trim() || newPhotoFile.name : newPhotoFile.name
        );
      } else {
        const selectedValue = values.photoChoice ? String(values.photoChoice) : '';
        const selectedId = selectedValue ? Number(selectedValue) : null;
        const currentId = currentPhoto ? currentPhoto.id : null;
        if (selectedId !== currentId) {
          await apiPut(`/places/${place.id}/photo`, { photoId: selectedId });
        }
      }

      await Promise.all([loadPlaces(), refreshPlaceLibrary()]);
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
      await uploadPlacePhoto(
        place.id,
        file,
        values.title ? String(values.title).trim() || file.name : file.name
      );
      await Promise.all([loadPlaces(), refreshPlaceLibrary()]);
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
  await Promise.all([loadPlaces(), refreshPlaceLibrary()]);
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

if (createPlaceButton) {
  createPlaceButton.addEventListener('click', openCreatePlaceModal);
}

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

const init = async () => {
  try {
    await Promise.all([loadPlaces(), refreshPlaceLibrary()]);
  } catch (error) {
    console.error('No se pudieron cargar los lugares', error);
  }
};

void init();
