import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction, fileToBase64 } from './ui.js';

const { user } = initAuthPage();
if (!user) {
  throw new Error('Usuario no autenticado');
}

const categoryForm = document.getElementById('categoryForm');
const categoryMessage = document.getElementById('categoryMessage');
const categoriesList = document.getElementById('categoriesList');
const categoryNameInput = document.getElementById('categoryName');
const categoryDescriptionInput = document.getElementById('categoryDescription');
const categoryPhotoFileInput = document.getElementById('categoryPhotoFile');
const categoryPhotoTitleInput = document.getElementById('categoryPhotoTitle');

let categories = [];

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

const handleCreateCategory = async (event) => {
  event.preventDefault();
  categoryMessage.style.display = 'none';
  const name = categoryNameInput.value.trim();
  const description = categoryDescriptionInput.value.trim();
  const photoFile = categoryPhotoFileInput?.files?.[0] ?? null;
  const photoTitle = categoryPhotoTitleInput.value.trim();

  if (!name) {
    categoryMessage.textContent = 'El nombre es obligatorio';
    categoryMessage.className = 'alert error';
    categoryMessage.style.display = 'block';
    return;
  }
  try {
    const category = await apiPost('/categories', {
      name,
      description
    });
    if (photoFile instanceof File) {
      await uploadCategoryPhoto(
        category.id,
        photoFile,
        photoTitle ? photoTitle : photoFile.name
      );
    }
    categoryMessage.textContent = 'Categoría creada correctamente';
    categoryMessage.className = 'alert success';
    categoryMessage.style.display = 'block';
    categoryForm.reset();
    categoryNameInput.focus();
    await loadCategories();
  } catch (error) {
    categoryMessage.textContent = error.message;
    categoryMessage.className = 'alert error';
    categoryMessage.style.display = 'block';
  }
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

      await loadCategories();
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
      await loadCategories();
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
  await loadCategories();
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

categoryForm.addEventListener('submit', handleCreateCategory);

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

loadCategories();
