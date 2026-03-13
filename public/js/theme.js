/* theme.js — paste as FIRST <script> in every page <head> */
(function () {
  const KEY = 'ep-theme';
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
    document.querySelectorAll('.theme-toggle-btn').forEach(b => {
      b.textContent = theme === 'dark' ? '☀️' : '🌙';
      b.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    });
  }
  apply(localStorage.getItem(KEY) || 'dark');
  window.toggleTheme = function () {
    apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  };
  document.addEventListener('DOMContentLoaded', () => apply(localStorage.getItem(KEY) || 'dark'));
})();