/*
  main.js - Application entry point / bootstrap for PathoMap.

  Purpose: Wires together the three subsystems (database view, upload UI,
  dataset loader) and starts the app once the DOM is ready. Also owns the
  dark-mode toggle behavior.

  Exports: none (runs as an IIFE on load).

  Key behaviors:
    - Applies the saved theme (localStorage key "pathomap-theme") to <html>
      by toggling the data-theme attribute.
    - Binds the #dark-toggle button to flip the theme and persist the choice.
    - boot(): initializes the database view and upload UI, then fetches the
      curated dataset via loadDataset() and reports success/failure in the
      upload status bar. On fetch failure, prompts the user to serve over HTTP.

  Imports:
    - loadDataset            js/data/loader.js
    - initDatabase,
      renderDatabase         js/views/database.js
    - initUpload,
      setUploadStatus        js/ui/upload.js

  Loaded by: index.html via <script type="module" src="js/main.js">.
*/

import { loadDataset } from './data/loader.js';
import { initDatabase, renderDatabase } from './views/database.js';
import { initUpload, setUploadStatus } from './ui/upload.js';

(function () {
  // Apply the persisted theme (if any) before anything renders to avoid a flash
  const root = document.documentElement;
  const toggle = document.getElementById('dark-toggle');
  const saved = localStorage.getItem('pathomap-theme');
  if (saved === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (saved === 'light') {
    root.removeAttribute('data-theme');
  }

  // Toggle dark mode on button click; persists the choice for next visit
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

  // Boot the application: initialize components and load dataset
  async function boot() {
    initDatabase();
    initUpload({ render: renderDatabase });

    try {
      const dataset = await loadDataset();
      renderDatabase();
      const pathogenCount = dataset.pathogens.length;
      const effectorCount = dataset.effectors?.length || 0;
      setUploadStatus(
        `Loaded ${pathogenCount} pathogen${pathogenCount === 1 ? '' : 's'} and ${effectorCount} effector${effectorCount === 1 ? '' : 's'} from data/pathomap-dataset.json.`,
        'success'
      );
    } catch (error) {
      // Most common cause: opened via file:// instead of an HTTP server
      setUploadStatus(
        'Could not load data/pathomap-dataset.json. Serve the site over HTTP (for example, python -m http.server).',
        'error'
      );
      console.error(error);
    }
  }

  // Wait for DOM to be ready before booting (handles both slow-fast load orders)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
