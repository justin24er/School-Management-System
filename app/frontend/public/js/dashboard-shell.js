/* Builds the common shell (sidebar / topbar / right rail) for every
   dashboard and enforces that the logged-in user's role actually matches
   the page they're on — client-side, for UX only. The real enforcement
   already happened on the server for every API call this page makes. */
const NAV_BY_ROLE = {
  PLATFORM_ADMIN: [
    { icon: 'fa-grid-2', label: 'Dashboard', href: '/dashboards/admin.html' },
    { icon: 'fa-school', label: 'Schools', href: '#schools' },
    { icon: 'fa-ticket', label: 'Subscriptions', href: '#subscriptions' },
    { icon: 'fa-heart-pulse', label: 'System Health', href: '#health' },
    { icon: 'fa-shield-halved', label: 'Security', href: '#security' },
    { icon: 'fa-triangle-exclamation', label: 'Incidents', href: '#incidents' },
  ],
  SED: [
    { icon: 'fa-grid-2', label: 'Overview', href: '/dashboards/sed.html' },
    { icon: 'fa-sack-dollar', label: 'Finance', href: '#finance' },
    { icon: 'fa-bolt', label: 'Resources', href: '#resources' },
    { icon: 'fa-building', label: 'Infrastructure', href: '#infrastructure' },
    { icon: 'fa-users', label: 'Staff & Students', href: '#people' },
  ],
  HEAD_TEACHER: [
    { icon: 'fa-grid-2', label: 'Dashboard', href: '/dashboards/head-teacher.html' },
    { icon: 'fa-user-graduate', label: 'Students', href: '#students' },
    { icon: 'fa-chalkboard-user', label: 'Teachers', href: '#teachers' },
    { icon: 'fa-chart-line', label: 'Academics', href: '#academics' },
    { icon: 'fa-building', label: 'Infrastructure', href: '#infrastructure' },
  ],
  ACCOUNTANT: [
    { icon: 'fa-grid-2', label: 'Dashboard', href: '/dashboards/accountant.html' },
    { icon: 'fa-file-invoice-dollar', label: 'Fees & Payments', href: '#fees' },
    { icon: 'fa-user-plus', label: 'Enrollment', href: '#enrollment' },
    { icon: 'fa-receipt', label: 'Expenses', href: '#expenses' },
    { icon: 'fa-people-group', label: 'Staff', href: '#staff' },
  ],
};

const ROLE_LABEL = {
  PLATFORM_ADMIN: 'Platform Admin',
  SED: 'School Executive Director',
  HEAD_TEACHER: 'Head Teacher',
  ACCOUNTANT: 'Accountant',
};

function initials(name) {
  return name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatMoney(n) {
  return 'TZS ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

async function initShell(requiredRole) {
  initThemeToggle();

  let me;
  try {
    me = await API.get('/api/auth/me');
  } catch (err) {
    window.location.href = '/index.html';
    return null;
  }

  if (!me.user.roles.includes(requiredRole)) {
    // Signed in, but this isn't their dashboard — send them to the one that is.
    const redirects = {
      PLATFORM_ADMIN: '/dashboards/admin.html', SED: '/dashboards/sed.html',
      HEAD_TEACHER: '/dashboards/head-teacher.html', ACCOUNTANT: '/dashboards/accountant.html',
    };
    const theirRole = me.user.roles[0];
    window.location.href = redirects[theirRole] || '/index.html';
    return null;
  }

  const nav = NAV_BY_ROLE[requiredRole];
  const navHost = document.getElementById('sidebar-nav');
  navHost.innerHTML = nav.map((item, i) => `
    <a class="nav-item ${i === 0 ? 'active' : ''}" href="${item.href}">
      <i class="fa-solid ${item.icon}"></i><span>${item.label}</span>
    </a>
  `).join('');

  document.getElementById('who-name').textContent = me.user.username;
  document.getElementById('who-role').textContent = ROLE_LABEL[requiredRole];
  document.getElementById('avatar').textContent = initials(me.user.username);

  const schoolNameEl = document.getElementById('school-name-label');
  if (schoolNameEl && me.school) schoolNameEl.textContent = me.school.name;

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await API.post('/api/auth/logout');
    window.location.href = '/index.html';
  });

  if (requiredRole !== 'PLATFORM_ADMIN') {
    try {
      const status = await API.get('/api/dashboard/service-status');
      renderServiceStatus(status);
    } catch (_) { /* non-fatal */ }
  }

  return me;
}

function renderServiceStatus(status) {
  const host = document.getElementById('service-status-card');
  if (!host) return;
  const endsAt = status.endsAt ? new Date(status.endsAt).toLocaleDateString() : null;

  const copy = {
    trial: { title: 'Free trial active', body: endsAt ? `Your trial ends on ${endsAt}.` : '', alert: false },
    active: { title: 'Service active', body: endsAt ? `Your subscription renews on ${endsAt}.` : '', alert: false },
    expiring_soon: { title: 'Service expiring soon', body: `Your service period ends on ${endsAt}. Renew to avoid interruption.`, alert: true },
    grace_period: { title: 'Grace period', body: `Your service expired on ${endsAt}. Renew now to keep access.`, alert: true },
    expired: { title: 'Service expired', body: 'Your service period has ended. Renew to restore full access.', alert: true },
    frozen: { title: 'Account frozen', body: 'Your account has been frozen by the platform. Contact support.', alert: true },
    suspended: { title: 'Account suspended', body: 'Your account has been suspended. Contact support.', alert: true },
  };
  const c = copy[status.status] || copy.active;
  host.className = 'status-card' + (c.alert ? ' alert' : '');
  host.innerHTML = `<h3>${c.title}</h3><p>${c.body}</p>` + (c.alert ? '<button class="cta">Renew service</button>' : '');
}

function renderEmpty(container, message) {
  container.innerHTML = `<div class="empty-state">${message}</div>`;
}
function renderLoading(container, message = 'Loading...') {
  container.innerHTML = `<div class="loading-state">${message}</div>`;
}
function renderError(container, message = 'Unable to load this information right now.') {
  container.innerHTML = `<div class="error-state">${message}</div>`;
}

/* Chart.js binds a Chart instance to a <canvas> element; creating a second
   chart on the same canvas without destroying the first throws "Canvas is
   already in use." Dashboards reload their data (and therefore re-draw
   their charts) after every write action, e.g. adding a student or
   recording a payment — so every chart on every dashboard must go through
   this helper instead of calling `new Chart(...)` directly. `key` just
   needs to be unique per chart on the page (e.g. the canvas id). */
const _chartRegistry = {};
function renderChart(key, ctx, config) {
  if (_chartRegistry[key]) {
    _chartRegistry[key].destroy();
  }
  const merged = {
    ...config,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...(config.options || {}),
    },
  };
  _chartRegistry[key] = new Chart(ctx, merged);
  return _chartRegistry[key];
}

/* ---------------------------------------------------------------------
   Dark mode: a single data-theme attribute on <html>, persisted in
   localStorage, read/written by every page that includes this file. The
   inline script in each page's <head> already applies the saved theme
   before first paint (see the snippet at the top of each HTML file) so
   there is no flash of the wrong theme — this just wires up the toggle
   button and keeps it in sync if the user switches.
--------------------------------------------------------------------- */
const THEME_KEY = 'sma-theme';

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'light';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.innerHTML = theme === 'dark'
    ? '<i class="fa-solid fa-sun"></i>'
    : '<i class="fa-solid fa-moon"></i>';
}

function initThemeToggle() {
  setTheme(getTheme());
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  });
}

/* ---------------------------------------------------------------------
   Modal open/close with a small scale+fade animation. The animation
   itself lives in dashboard.css (.modal-backdrop.show, .modal.closing);
   this just sequences the classes correctly — "closing" has to be added
   and then the backdrop removed only after the animation finishes,
   otherwise the modal just vanishes instantly instead of animating out.
--------------------------------------------------------------------- */
const MODAL_CLOSE_MS = 180;

function openModal(backdrop) {
  const box = backdrop.querySelector('.modal');
  if (box) box.classList.remove('closing');
  backdrop.classList.add('show');
}

function closeModal(backdrop) {
  const box = backdrop.querySelector('.modal');
  if (box) box.classList.add('closing');
  setTimeout(() => {
    backdrop.classList.remove('show');
    if (box) box.classList.remove('closing');
  }, MODAL_CLOSE_MS);
}
