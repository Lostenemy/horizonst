import { apiGet, clearSession, getCurrentUser } from './api.js';

document.getElementById('logoutLink').addEventListener('click', (event) => {
  event.preventDefault();
  clearSession();
  window.location.href = '/';
});

document.getElementById('year').textContent = new Date().getFullYear();

if (!getCurrentUser()) {
  window.location.href = '/';
}

const tableBody = document.querySelector('#messagesTable tbody');
const emptyState = document.getElementById('messagesEmpty');

const loadMessages = async () => {
  try {
    const messages = await apiGet('/messages');
    tableBody.innerHTML = '';
    if (!messages.length) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';
    messages.forEach((message) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${new Date(message.received_at).toLocaleString()}</td>
        <td>${message.gateway_name || message.gateway_mac || '—'}</td>
        <td>${message.topic}</td>
        <td><pre style="white-space:pre-wrap;word-break:break-word;margin:0;">${message.payload}</pre></td>
      `;
      tableBody.appendChild(row);
    });
  } catch (error) {
    tableBody.innerHTML = `<tr><td colspan="4">${error.message}</td></tr>`;
  }
};

loadMessages();
setInterval(loadMessages, 15000);
