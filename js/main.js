
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
    - renderReferences              js/ui/references.js
    - initTheme                      js/ui/theme.js

  Loaded by:
    index.html via <script type="module" src="js/main.js">
*/

import { DEFAULT_DATASET_URL, HTTP_SETUP_HINT, loadDataset } from './data/loader.js';
import { pluralize } from './utils/format.js';
import { initDatabase, renderDatabase } from './views/database.js';
import { initUpload, setUploadStatus } from './ui/upload.js';
import { renderAnalyses } from './ui/analyses.js';
import { renderReferences } from './ui/references.js';
import { initTheme } from './ui/theme.js';

(function () {

    // ========================================
    // DARK MODE
    // ========================================

    initTheme();


    // ========================================
    // APPLICATION BOOTSTRAP
    // ========================================

    async function initApp() {

        // Initialize application interfaces
        initDatabase();
        initUpload({
            // upload.js passes the updated dataset after every successful load
            render: (dataset) => {
                renderDatabase();
                renderAnalyses(dataset);
                renderReferences(dataset);
            }
        });

        try {

            // Load the default dataset
            const dataset = await loadDataset();

            // Render analysis eligibility and references (database rendered by initDatabase)
            renderAnalyses(dataset);
            renderReferences(dataset);

            // Dataset statistics
            const pathogenCount = dataset.pathogens.length;
            const effectorCount = dataset.effectors?.length || 0;

            // Report successful loading
            setUploadStatus(
                `Loaded ${pluralize(pathogenCount, 'pathogen')} and ${pluralize(effectorCount, 'effector')} from ${DEFAULT_DATASET_URL}.`,
                'success'
            );

        } catch (error) {

            // Render analysis modules without an available dataset
            renderAnalyses(null);
            renderReferences(null);

            // Report loading failure
            setUploadStatus(
                `Could not load ${DEFAULT_DATASET_URL}. ${HTTP_SETUP_HINT}`,
                'error'
            );

            console.error(error);
        }
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
