/*
  discovery.js - Unified Discovery Workspace.

  One dataset (pasted rows, uploaded table, uploaded dataset JSON, curated or
  sample dataset) feeds every implemented module in docs/ANALYSES.md. The same
  dataset also drives the results table rendered by js/views/database.js.
*/

import { runDiscovery, DISCOVERY_MODULES } from '../discovery/engine.js';
import { ingestText, summarizeUpload } from '../discovery/ingest.js';
import {
  DEFAULT_DATASET_URL,
  DEFAULT_SAMPLE_DATASET_URL,
  HTTP_SETUP_HINT,
  setDataset,
} from '../data/loader.js';
import { queueDatasetForModule } from '../discovery/dataset-handoff.js';
import { renderDatabase } from '../views/database.js';
import { downloadText, timestampSlug } from '../utils/export.js';
import {
  EXAMPLE,
  TEMPLATE,
  setStatus,
  renderMetrics,
  renderModuleSummary,
  renderWaitingSummary,
  renderMappingGrid,
  readMappingOverrides,
} from './module-view.js';

// main.js calls this after a dataset is explicitly loaded so the modules and
// the results table always reflect the same data.
let datasetRenderer = null;

export function showDiscoveryDataset(dataset, meta = {}) {
  if (typeof datasetRenderer === 'function') datasetRenderer(dataset, meta);
}

export function initDiscovery() {
  const input = document.getElementById('disc-input');
  const file = document.getElementById('disc-file');
  const example = document.getElementById('disc-example');
  const template = document.getElementById('disc-template');
  const curated = document.getElementById('disc-curated');
  const sample = document.getElementById('disc-sample');
  const analyze = document.getElementById('disc-analyze');
  const download = document.getElementById('disc-download');
  const status = document.getElementById('disc-status');
  const mapping = document.getElementById('disc-mapping');
  const mappingGrid = document.getElementById('disc-mapping-grid');
  const uploadSummary = document.getElementById('disc-upload-summary');
  const results = document.getElementById('disc-results');

  if (!input || !analyze || !results) return;

  let lastIngest = null;
  let lastReport = null;
  let lastMeta = {};

  function renderWaiting() {
    results.hidden = false;
    results.innerHTML = `
      <div class="disc-results-head">
        <h3>Module summaries</h3>
        <p>Load an example or dataset above, or paste your own rows. Open a module page for full results.</p>
      </div>
      <div class="disc-summary-grid">
        ${DISCOVERY_MODULES.map(renderWaitingSummary).join('')}
      </div>
    `;
    if (download) download.disabled = true;
  }

  function renderReport(report) {
    lastReport = report;
    results.hidden = false;
    results.innerHTML = `
      <div class="disc-results-head">
        <h3>Module summaries</h3>
        <p>${report.summary.complete} of ${report.summary.total} modules produced results.
          ${report.summary.insufficient ? `${report.summary.insufficient} need more data.` : ''}
          Open a module page for full tables and visualizations.</p>
      </div>
      <div class="disc-summary-grid">
        ${report.modules.map(renderModuleSummary).join('')}
      </div>
    `;
    if (download) download.disabled = false;
  }

  function showDataset(dataset, meta = {}) {
    // Pasted/uploaded rows become the active dataset so the results table shows
    // exactly the rows the modules analyzed. Loader-provided datasets are
    // already active and are not re-ingested.
    if (meta.sync !== false) {
      setDataset(dataset);
      renderDatabase();
    }

    lastMeta = meta;
    lastIngest = {
      ok: true,
      sourceKind: meta.sourceKind || 'dataset',
      dataset,
      mapping: meta.mapping || {},
      headers: meta.headers || [],
      rowCount: meta.rowCount ?? 0,
      warnings: meta.warnings || [],
      errors: [],
    };

    if (uploadSummary) {
      uploadSummary.hidden = false;
      uploadSummary.innerHTML = renderMetrics(summarizeUpload(dataset));
    }
    if (meta.status) setStatus(status, meta.status, meta.tone || 'success');

    renderReport(runDiscovery(dataset));
  }

  datasetRenderer = showDataset;
  renderWaiting();

  function analyzeInput() {
    const ingest = ingestText(input.value, readMappingOverrides(mapping));
    if (!ingest.ok) {
      lastReport = null;
      renderWaiting();
      setStatus(status, ingest.errors.join(' '), 'error');
      return;
    }

    if (mappingGrid && ingest.sourceKind !== 'json') {
      renderMappingGrid(mapping, ingest.headers, ingest.mapping);
    } else if (mapping) {
      mapping.hidden = true;
    }

    showDataset(ingest.dataset, {
      sourceKind: ingest.sourceKind,
      mapping: ingest.mapping,
      headers: ingest.headers,
      rowCount: ingest.rowCount,
      warnings: ingest.warnings,
      status: ingest.warnings.length
        ? `Analyzed ${ingest.rowCount} row(s). ${ingest.warnings.join(' ')}`
        : `Analyzed ${ingest.rowCount} row(s).`,
      tone: ingest.warnings.length ? '' : 'success',
    });
  }

  if (example) {
    example.addEventListener('click', () => {
      input.value = EXAMPLE;
      setStatus(status, 'Example loaded. Analyzing...', 'success');
      analyzeInput();
    });
  }

  if (file) {
    file.addEventListener('change', async () => {
      const selected = file.files?.[0];
      if (!selected) return;
      try {
        input.value = await selected.text();
        setStatus(status, `Loaded ${selected.name}. Analyzing...`, 'success');
        analyzeInput();
      } catch (error) {
        setStatus(status, `Could not read ${selected.name}: ${error.message}`, 'error');
      }
    });
  }

  if (template) {
    template.addEventListener('click', () => {
      downloadText(TEMPLATE, `pathomap-upload-template-${timestampSlug()}.csv`, 'text/csv;charset=utf-8');
      setStatus(status, 'Template downloaded. Fill in your own rows and upload it.', 'success');
    });
  }

  async function loadReference(url, label) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      input.value = await response.text();
      setStatus(status, `${label} loaded. Analyzing...`, 'success');
      analyzeInput();
    } catch (error) {
      setStatus(status, `Could not load ${label}. ${HTTP_SETUP_HINT}`, 'error');
    }
  }

  if (curated) curated.addEventListener('click', () => loadReference(DEFAULT_DATASET_URL, 'Curated dataset'));
  if (sample) sample.addEventListener('click', () => loadReference(DEFAULT_SAMPLE_DATASET_URL, 'Sample dataset'));

  analyze.addEventListener('click', analyzeInput);

  // Carry the active dataset into a module page only when a user follows a
  // module link. The receiving page consumes and clears it immediately.
  function queueCurrentDataset() {
    if (lastIngest) queueDatasetForModule(lastIngest.dataset);
  }
  results.addEventListener('click', (event) => {
    if (event.target.closest('a.disc-summary-link')) queueCurrentDataset();
  });
  document.querySelectorAll('.nav-module a').forEach((link) => {
    link.addEventListener('click', queueCurrentDataset);
  });

  if (download) {
    download.addEventListener('click', () => {
      if (!lastReport || !lastIngest) return;
      const portable = {
        meta: {
          generated_at: new Date().toISOString(),
          source: 'pathomap-discovery',
          source_kind: lastIngest.sourceKind,
          label: lastMeta.label || null,
        },
        upload: summarizeUpload(lastIngest.dataset),
        mapping: lastIngest.mapping,
        warnings: lastIngest.warnings,
        modules: lastReport.modules.map(({ network, ...module }) => module),
      };
      downloadText(
        JSON.stringify(portable, null, 2),
        `pathomap-discovery-report-${timestampSlug()}.json`,
        'application/json;charset=utf-8'
      );
    });
  }
}
