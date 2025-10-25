import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { initAuthPage, openFormModal, confirmAction, fileToBase64 } from './ui.js';

const { user } = initAuthPage();
if (!user) {
  throw new Error('Usuario no autenticado');
}

const categoryForm = document.getElementById('categoryForm');
const categoryMessage = document.getElementById('categoryMessage');
const categoriesList = document.getElementById('categoriesList');

let categories = [];

const loadCategories = async () => {
  categories = await apiGet('/categories');
  renderCategories();
};

const handleCreateCategory = async (event) => {
  event.preventDefault();
  categoryMessage.style.display = 'none';
  const payload = {
    name: categoryForm.categoryName.value.trim(),
    description: categoryForm.categoryDescription.value.trim(),
    photoUrl: categoryForm.categoryPhoto.value.trim()
  };
  if (!payload.name) {
    categoryMessage.textContent = 'El nombre es obligatorio';
    categoryMessage.className = 'alert error';
    categoryMessage.style.display = 'block';
    return;
  }
  try {
    await apiPost('/categories', payload);
    categoryMessage.textContent = 'Categoría creada correctamente';
    categoryMessage.className = 'alert success';
    categoryMessage.style.display = 'block';
    categoryForm.reset();
    await loadCategories();
  } catch (error) {
    categoryMessage.textContent = error.message;
    categoryMessage.className = 'alert error';
    categoryMessage.style.display = 'block';
  }
};

const handleEditCategory = async (category) => {
  await openFormModal({
    title: `Editar categoría ${category.name}`,
    submitText: 'Guardar cambios',
    fields: [
      { name: 'name', label: 'Nombre', type: 'text', required: true },
      { name: 'description', label: 'Descripción', type: 'textarea', rows: 3 },
      { name: 'photoUrl', label: 'URL de foto', type: 'text', placeholder: 'https://' }
    ],
    initialValues: {
      name: category.name,
      description: category.description || '',
      photoUrl: category.photo_url || ''
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
      await apiPut(`/categories/${category.id}`, payload);
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
      const imageData = await fileToBase64(file);
      await apiPost(`/categories/${category.id}/photos`, {
        title: values.title ? String(values.title).trim() || file.name : file.name,
        imageData
      });
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
