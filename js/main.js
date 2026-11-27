
/*
  main.js - Application entry point / bootstrap for PathoMap.

  Purpose:
    Boots the unified Discovery workspace. Its single upload/load area feeds
    the module summaries and the inline data table.

  Responsibilities:
    - Initialize and persist dark mode.
    - Initialize the Discovery workspace and data table in an empty state.
    - Clear any legacy dataset cache from older builds.
    - Never restore or fetch a dataset automatically on page load.
    - Run modules only after an explicit upload or load action.

  Imports:
    - clearStoredDataset           js/data/loader.js
    - initDatabase,
      renderDatabase                js/views/database.js
    - initDiscovery                 js/ui/discovery.js
    - initTheme                      js/ui/theme.js

  Loaded by:
    index.html via <script type="module" src="js/main.js">
*/

import { clearStoredDataset } from './data/loader.js';
import { initDatabase, renderDatabase } from './views/database.js';
import { initDiscovery } from './ui/discovery.js';
import { initTheme } from './ui/theme.js';

(function () {

    // ========================================
    // DARK MODE
    // ========================================

    initTheme();


    // ========================================
    // APPLICATION BOOTSTRAP
    // ========================================

    function initApp() {

        // Initialize application interfaces. Discovery renders waiting cards;
        // no dataset is read from localStorage or fetched at boot.
        clearStoredDataset();
        initDiscovery();
        initDatabase();
        renderDatabase();
    }


    // ========================================
    // DOM INITIALIZATION
    // ========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }

})();
