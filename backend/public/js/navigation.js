export function renderNavigation(user) {
  const nav = document.getElementById('adminNavigation');
  if (!nav || !user) return;
  const global = ['ADMIN','hardware_superadmin'].includes(user.role);
  const hardware = global || ['hardware_technician','hardware_readonly'].includes(user.role);
  const pages = [
    ['dashboard.html','Resumen',true],['devices.html','Dispositivos',true],
    ['gateways.html','Gateways',true],['companies.html','Compañías',hardware],
    ['device-types.html','Tipos de dispositivos',true],['users.html','Usuarios',global],
    ['categories.html','Categorías',true],['messages.html','Mensajes',true],
    ['history.html','Históricos',true],['alarms.html','Alarmas',true]
  ];
  nav.replaceChildren();
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.textContent = 'Menú'; toggle.className = 'nav-toggle';
  toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-controls','adminNavLinks');
  const links = document.createElement('div'); links.id = 'adminNavLinks'; links.className = 'nav-links';
  for (const [href,label,allowed] of pages) {
    if (!allowed) continue;
    const link = document.createElement('a'); link.href = href; link.textContent = label;
    if (window.location.pathname.split('/').pop() === href) { link.className = 'active'; link.setAttribute('aria-current','page'); }
    links.appendChild(link);
  }
  const logout = document.createElement('a'); logout.href = '#'; logout.id = 'logoutLink'; logout.textContent = 'Salir'; links.appendChild(logout);
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded',String(expanded)); nav.dataset.open = String(expanded);
  });
  nav.addEventListener('keydown', event => {
    if (event.key === 'Escape') { nav.dataset.open = 'false'; toggle.setAttribute('aria-expanded','false'); toggle.focus(); }
  });
  nav.append(toggle,links);
}
