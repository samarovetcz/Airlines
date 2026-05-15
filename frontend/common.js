function isAuthed() {
  return Boolean(localStorage.getItem('token'));
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}');
  } catch (_) {
    return {};
  }
}

function isAdmin() {
  const user = getStoredUser();
  return user && user.role === 'admin';
}

const API_BASE = '';

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location = 'login.html';
}

function requireAuth() {
  if (!isAuthed()) {
    window.location = 'login.html';
    return false;
  }
  return true;
}

function requireAdmin() {
  if (!requireAuth()) return false;
  if (!isAdmin()) {
    window.location = 'index.html';
    return false;
  }
  return true;
}

function getCurrentUserId() {
  const storedUser = getStoredUser();
  if (storedUser && storedUser.id) return Number(storedUser.id);

  const token = localStorage.getItem('token');
  if (!token) return null;

  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
        .join('')
    );
    const payload = JSON.parse(json);
    if (payload && payload.id) return Number(payload.id);
  } catch (_) {}

  return null;
}

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...authHeaders()
    }
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const error = new Error(
      typeof payload === 'string' ? payload : payload.error || 'Ошибка запроса'
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function apiGet(path) {
  return apiRequest(path, { method: 'GET' });
}

function apiPost(path, body) {
  return apiRequest(path, { method: 'POST', body: JSON.stringify(body || {}) });
}

function navLink(href, label, active) {
  const isActive = active === href;
  const cls = isActive ? 'btn btn-light' : 'btn btn-outline-light';
  return `<a href="${href}" class="${cls}">${label}</a>`;
}

function renderNavbar(options = {}) {
  const { active = '', mode } = options;
  const root = document.getElementById('app-navbar');
  if (!root) return;

  const authed = mode ? mode === 'auth' : isAuthed();
  const authButtons = authed
    ? `
      ${navLink('index.html', 'Главная', active)}
      ${navLink('flights.html', 'Рейсы', active)}
      ${navLink('seats.html', 'Выбор мест', active)}
      ${navLink('profile.html', 'Мои билеты', active)}
      ${isAdmin() ? navLink('admin.html', 'Админ', active) : ''}
      <button class="btn btn-outline-warning" onclick="logout()">Выйти</button>
    `
    : `
      ${navLink('index.html', 'Главная', active)}
      ${navLink('login.html', 'Вход', active)}
      ${navLink('register.html', 'Регистрация', active)}
    `;

  root.innerHTML = `
    <nav class="navbar navbar-dark bg-dark">
      <div class="container">
        <a class="navbar-brand" href="index.html">✈ Авиабилеты</a>
        <div class="d-flex gap-2">${authButtons}</div>
      </div>
    </nav>
  `;
}

