/*
  module-page.js - Standalone page for one discovery module.

  Each module has its own URL (for example pages/pathway-analysis.html). Upload
  and dataset-load controls live only in the workspace. A module page consumes
  the one-shot dataset handoff from a workspace link, runs only its own module,
  and never restores data from a previous session.
*/

import { initTheme } from '../ui/theme.js';
import { DISCOVERY_MODULES, runDiscovery } from '../discovery/engine.js';
import { summarizeUpload } from '../discovery/ingest.js';
import { consumeQueuedDataset, queueDatasetForModule } from '../discovery/dataset-handoff.js';
import { downloadText, timestampSlug } from '../utils/export.js';
import {
  renderWaitingModule,
  renderModule,
  mountNetworks,
  mountModuleViews,
} from '../ui/module-view.js';

initTheme();

const moduleId = document.body.dataset.module;
const moduleMeta = DISCOVERY_MODULES.find((module) => module.id === moduleId);
const mount = document.getElementById('module-page');
const WAITING_MESSAGE = 'No dataset on this page. Load data in the Workspace, then open this module.';

if (!mount) {
  throw new Error('Module page mount element #module-page is missing.');
}

if (!moduleMeta) {
  mount.innerHTML = `<p class="exp-status exp-status--error">Unknown analysis module: ${moduleId || '(none)'}</p>`;
} else {
  mount.innerHTML = `
    <div class="exp-results mod-results">
      <div class="disc-results-head mod-results-head">
        <div>
          <h3>${moduleMeta.name}</h3>
          <p>${moduleMeta.question}</p>
        </div>
        <button type="button" class="tool-btn tool-btn-sm" id="mod-download" disabled>Download result</button>
      </div>
      <div id="mod-results-body"></div>
    </div>
  `;

  const download = document.getElementById('mod-download');
  const results = document.getElementById('mod-results-body');

  let lastDataset = null;
  let lastResult = null;

  function renderWaiting() {
    results.innerHTML = renderWaitingModule(moduleMeta, { message: WAITING_MESSAGE });
    download.disabled = true;
    lastDataset = null;
    lastResult = null;
  }

  function showDataset(dataset) {
    lastDataset = dataset;
    lastResult = runDiscovery(dataset).modules.find((module) => module.id === moduleId) || null;

    results.innerHTML = lastResult ? renderModule(lastResult, { open: true }) : '';
    mountModuleViews(results);
    mountNetworks(results, { modules: lastResult ? [lastResult] : [], dataset: lastDataset });
    download.disabled = !lastResult;
  }

  if (download) {
    download.addEventListener('click', () => {
      if (!lastResult || !lastDataset) return;
      const { network, ...portableResult } = lastResult;
      const report = {
        meta: {
          generated_at: new Date().toISOString(),
          source: 'pathomap-module-page',
          module: moduleId,
          source_kind: 'dataset-handoff',
        },
        upload: summarizeUpload(lastDataset),
        module: portableResult,
      };
      downloadText(
        JSON.stringify(report, null, 2),
        `pathomap-${moduleId}-${timestampSlug()}.json`,
        'application/json;charset=utf-8'
      );
    });
  }

  // Move the current dataset across module-page nav links, then clear it on
  // arrival. This is a one-shot handoff, not a persistent cache.
  document.querySelectorAll('.nav-module a').forEach((link) => {
    link.addEventListener('click', () => {
      if (lastDataset) queueDatasetForModule(lastDataset);
    });
  });

  renderWaiting();
  const queued = consumeQueuedDataset();
  if (queued) showDataset(queued);
}
