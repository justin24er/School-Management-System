/* Same dark-mode mechanism as dashboard-shell.js's initThemeToggle(), kept
   as its own small file for pages (login, invitation, password reset) that
   don't load the full dashboard shell. Both read/write the same
   localStorage key, so the choice made on one page carries over to the
   other pages of the site. */
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

document.addEventListener('DOMContentLoaded', initThemeToggle);
