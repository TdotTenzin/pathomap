import { loadDataset } from './data/loader.js';
import { initDatabase, renderDatabase } from './views/database.js';
import { initUpload, setUploadStatus } from './ui/upload.js';

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

  async function boot() {
    initDatabase();
    initUpload({ render: renderDatabase });

    try {
      const dataset = await loadDataset();
      renderDatabase();
      const count = dataset.pathogens.length;
      setUploadStatus(
        `Loaded ${count} pathogen${count === 1 ? '' : 's'} from data/pathomap-dataset.json.`,
        'success'
      );
    } catch (error) {
      setUploadStatus(
        'Could not load data/pathomap-dataset.json. Serve the site over HTTP (for example, python -m http.server).',
        'error'
      );
      console.error(error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
