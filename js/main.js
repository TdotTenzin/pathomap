
/*
  main.js - Application entry point / bootstrap for PathoMap.

  Purpose:
    Connects the database view, upload interface, dataset loader,
    and Generated Analyses section.

  Responsibilities:
    - Initialize and persist dark mode.
    - Initialize database and upload interfaces.
    - Load the curated dataset.
    - Render the Generated Analyses modules.
    - Evaluate dataset eligibility for each analysis.
    - Report dataset loading success or failure.

  Imports:
    - loadDataset                    js/data/loader.js
    - initDatabase,
      renderDatabase                js/views/database.js
    - initUpload,
      setUploadStatus               js/ui/upload.js
    - renderAnalyses                js/ui/analyses.js
    - initTheme                      js/ui/theme.js

  Loaded by:
    index.html via <script type="module" src="js/main.js">
*/

import { loadDataset } from './data/loader.js';
import { initDatabase, renderDatabase } from './views/database.js';
import { initUpload, setUploadStatus } from './ui/upload.js';
import { renderAnalyses } from './ui/analyses.js';
import { initTheme } from './ui/theme.js';

(function () {

    // ========================================
    // DARK MODE
    // ========================================

    initTheme();


    // ========================================
    // APPLICATION BOOTSTRAP
    // ========================================

    async function boot() {

        // Initialize application interfaces
        initDatabase();
        initUpload({
            // upload.js passes the updated dataset after every successful load
            render: (dataset) => {
                renderDatabase();
                renderAnalyses(dataset);
            }
        });

        try {

            // Load the default dataset
            const dataset = await loadDataset();

            // Render database and evaluate analysis eligibility
            renderDatabase();
            renderAnalyses(dataset);

            // Dataset statistics
            const pathogenCount = dataset.pathogens.length;
            const effectorCount = dataset.effectors?.length || 0;

            // Report successful loading
            setUploadStatus(
                `Loaded ${pathogenCount} pathogen${pathogenCount === 1 ? '' : 's'} and ${effectorCount} effector${effectorCount === 1 ? '' : 's'} from data/pathomap-dataset.json.`,
                'success'
            );

        } catch (error) {

            // Render analysis modules without an available dataset
            renderAnalyses(null);

            // Report loading failure
            setUploadStatus(
                'Could not load data/pathomap-dataset.json. Serve the site over HTTP (for example, python -m http.server).',
                'error'
            );

            console.error(error);
        }
    }


    // ========================================
    // DOM INITIALIZATION
    // ========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
