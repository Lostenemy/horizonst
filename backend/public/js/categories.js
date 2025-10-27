import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction, fileToBase64 } from './ui.js';

const { user } = initAuthPage();
if (!user) {
  throw new Error('Usuario no autenticado');
}

const categoriesList = document.getElementById('categoriesList');
const createCategoryButton = document.getElementById('createCategoryButton');

let categories = [];
let categoryPhotoLibrary = [];

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

const refreshCategoryLibrary = async () => {
  try {
    categoryPhotoLibrary = await apiGet('/categories/photos/library');
  } catch (error) {
    console.error('No se pudo cargar la biblioteca de imágenes de categorías', error);
    categoryPhotoLibrary = [];
  }
};

const uploadCategoryPhoto = async (categoryId, file, title) => {
  const imageData = await fileToBase64(file);
  return apiPost(`/categories/${categoryId}/photos`, {
    title: title || file.name,
    imageData,
    mimeType: file.type || 'image/jpeg'
  });
};

const loadCategories = async () => {
  categories = await apiGet('/categories');
  renderCategories();
};

const openCreateCategoryModal = async () => {
  await refreshCategoryLibrary();
  const photoOptions = [
    { value: '', label: 'Sin imagen' },
    ...categoryPhotoLibrary.map((photo) => ({ value: String(photo.id), label: formatPhotoLabel(photo) }))
  ];

  await openFormModal({
    title: 'Nueva categoría',
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
        ? categoryPhotoLibrary.find((photo) => String(photo.id) === selectedValue)
        : null;

      const category = await apiPost('/categories', {
        name: nameValue,
        description: descriptionValue
      });

      const newPhotoFile = values.newPhoto;
      if (newPhotoFile instanceof File && newPhotoFile.size > 0) {
        await uploadCategoryPhoto(
          category.id,
          newPhotoFile,
          values.newPhotoTitle ? String(values.newPhotoTitle).trim() || newPhotoFile.name : newPhotoFile.name
        );
      } else if (selectedPhoto) {
        const base64 = extractBase64(selectedPhoto.image_url);
        if (base64) {
          await apiPost(`/categories/${category.id}/photos`, {
            title: selectedPhoto.title ?? null,
            imageData: base64,
            mimeType: selectedPhoto.mime_type || 'image/jpeg'
          });
        }
      }

      await Promise.all([loadCategories(), refreshCategoryLibrary()]);
    }
  });
};

const handleEditCategory = async (category) => {
  const photos = await apiGet(`/categories/${category.id}/photos`);
  const currentPhoto = category.photo_url
    ? photos.find((photo) => photo.image_url === category.photo_url)
    : null;
  const photoOptions = [
    { value: '', label: 'Sin imagen' },
    ...photos.map((photo) => ({ value: String(photo.id), label: formatPhotoLabel(photo) }))
  ];

  await openFormModal({
    title: `Editar categoría ${category.name}`,
    submitText: 'Guardar cambios',
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      { name: 'description', label: 'Descripción', type: 'textarea', rows: 3 },
      { name: 'photoChoice', label: 'Seleccionar imagen existente', type: 'select', options: photoOptions },
      { name: 'newPhotoTitle', label: 'Título para nueva imagen', type: 'text', placeholder: 'Descripción (opcional)' },
      { name: 'newPhoto', label: 'Subir nueva imagen', type: 'file', accept: 'image/*' }
    ],
    initialValues: {
      name: category.name,
      description: category.description || '',
      photoChoice: currentPhoto ? String(currentPhoto.id) : ''
    },
    onSubmit: async (values) => {
      const nameValue = values.name ? String(values.name).trim() : '';
      if (!nameValue) {
        throw new Error('El nombre es obligatorio');
      }
      const descriptionValue = values.description ? String(values.description).trim() : '';

      await apiPut(`/categories/${category.id}`, {
        name: nameValue,
        description: descriptionValue
      });

      const newPhotoFile = values.newPhoto;
      if (newPhotoFile instanceof File && newPhotoFile.size > 0) {
        await uploadCategoryPhoto(
          category.id,
          newPhotoFile,
          values.newPhotoTitle ? String(values.newPhotoTitle).trim() || newPhotoFile.name : newPhotoFile.name
        );
      } else {
        const selectedValue = values.photoChoice ? String(values.photoChoice) : '';
        const selectedId = selectedValue ? Number(selectedValue) : null;
        const currentId = currentPhoto ? currentPhoto.id : null;
        if (selectedId !== currentId) {
          await apiPut(`/categories/${category.id}/photo`, { photoId: selectedId });
        }
      }

      await Promise.all([loadCategories(), refreshCategoryLibrary()]);
    }
  });
};

const handleUploadPhoto = async (category) => {
  await openFormModal({
    title: `Subir imagen para ${category.name}`,
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
      await uploadCategoryPhoto(
        category.id,
        file,
        values.title ? String(values.title).trim() || file.name : file.name
      );
      await Promise.all([loadCategories(), refreshCategoryLibrary()]);
    }
  });
};

const handleDeleteCategory = async (category) => {
  const confirmed = await confirmAction({
    title: 'Eliminar categoría',
    message: `¿Seguro que quieres eliminar <strong>${category.name}</strong>?`,
    confirmText: 'Eliminar'
  });
  if (!confirmed) return;
  await apiDelete(`/categories/${category.id}`);
  await Promise.all([loadCategories(), refreshCategoryLibrary()]);
};

const renderCategories = () => {
  categoriesList.innerHTML = '';
  if (!categories.length) {
    categoriesList.innerHTML = '<p>No hay categorías creadas.</p>';
    return;
  }

  categories.forEach((category) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${category.name}</h3>
      <p>${category.description || 'Sin descripción'}</p>
      ${category.photo_url ? `<img src="${category.photo_url}" alt="${category.name}" style="width:100%;border-radius:8px;margin-bottom:1rem;" />` : ''}
      <div class="actions">
        <button data-id="${category.id}" data-action="edit">Editar</button>
        <button data-id="${category.id}" data-action="upload">Subir imagen</button>
        <button data-id="${category.id}" data-action="delete" class="secondary">Eliminar</button>
      </div>
    `;
    categoriesList.appendChild(card);
  });
};

if (createCategoryButton) {
  createCategoryButton.addEventListener('click', openCreateCategoryModal);
}

categoriesList.addEventListener('click', async (event) => {
  if (!(event.target instanceof HTMLElement)) return;
  const action = event.target.dataset.action;
  if (!action) return;
  const id = Number(event.target.dataset.id);
  const category = categories.find((item) => item.id === id);
  if (!category) return;

  if (action === 'edit') {
    await handleEditCategory(category);
  } else if (action === 'upload') {
    await handleUploadPhoto(category);
  } else if (action === 'delete') {
    await handleDeleteCategory(category);
  }
});

const init = async () => {
  try {
    await Promise.all([loadCategories(), refreshCategoryLibrary()]);
  } catch (error) {
    console.error('No se pudieron cargar las categorías', error);
  }
};

void init();
