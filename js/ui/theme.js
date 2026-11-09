/*
  theme.js - Shared dark-mode bootstrap.

  Purpose:
    Applies the saved theme on load and wires the #dark-toggle button.
    Extracted from main.js so standalone pages can reuse the same behavior.

  Exports:
    initTheme()  Restore the saved theme and bind the toggle button (if present).
*/

const STORAGE_KEY = 'pathomap-theme';

export function initTheme() {
    const root = document.documentElement;
    const toggle = document.getElementById('dark-toggle');
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved === 'dark') {
        root.setAttribute('data-theme', 'dark');
    } else if (saved === 'light') {
        root.removeAttribute('data-theme');
    }

    if (!toggle) return;

    toggle.addEventListener('click', function () {
        if (root.getAttribute('data-theme') === 'dark') {
            root.removeAttribute('data-theme');
            localStorage.setItem(STORAGE_KEY, 'light');
        } else {
            root.setAttribute('data-theme', 'dark');
            localStorage.setItem(STORAGE_KEY, 'dark');
        }
    });
}
