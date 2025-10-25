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

const categoryForm = document.getElementById('categoryForm');
const categoryMessage = document.getElementById('categoryMessage');
const categoriesList = document.getElementById('categoriesList');

const createCard = (category) => {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h3>${category.name}</h3>
    <p>${category.description || 'Sin descripción'}</p>
    ${category.photo_url ? `<img src="${category.photo_url}" alt="${category.name}" style="width:100%;border-radius:8px;margin-bottom:1rem;" />` : ''}
    <div class="actions">
      <button class="edit-btn" data-id="${category.id}">Editar</button>
    </div>
  `;
  return card;
};

const loadCategories = async () => {
  const categories = await apiGet('/categories');
  categoriesList.innerHTML = '';
  if (!categories.length) {
    categoriesList.innerHTML = '<p>No hay categorías creadas.</p>';
    return;
  }
  categories.forEach((category) => categoriesList.appendChild(createCard(category)));
};

categoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  categoryMessage.style.display = 'none';
  const payload = {
    name: categoryForm.categoryName.value.trim(),
    description: categoryForm.categoryDescription.value.trim(),
    photoUrl: categoryForm.categoryPhoto.value.trim()
  };
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
});

categoriesList.addEventListener('click', async (event) => {
  if (!(event.target instanceof HTMLElement)) return;
  if (!event.target.classList.contains('edit-btn')) return;
  const id = Number(event.target.dataset.id);
  const newName = prompt('Nuevo nombre de la categoría');
  if (!newName) return;
  try {
    await apiPut(`/categories/${id}`, { name: newName });
    await loadCategories();
  } catch (error) {
    alert(error.message);
  }
});

loadCategories();
