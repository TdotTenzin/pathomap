// main.js - bootstrap with theme toggle
(function () {
  const root = document.documentElement;
  const toggle = document.getElementById('dark-toggle');
  const saved = localStorage.getItem('pathomap-theme');
  if (saved === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (saved === 'light') {
    root.removeAttribute('data-theme');
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      if (root.getAttribute('data-theme') === 'dark') {
        root.removeAttribute('data-theme');
        localStorage.setItem('pathomap-theme', 'light');
      } else {
        root.setAttribute('data-theme', 'dark');
        localStorage.setItem('pathomap-theme', 'dark');
      }
    });
  }
})();

