/*
  sequence-analysis.js - Entry script for the Sequence Analysis page.

  Boot:
    1. Use the one-shot dataset handed off from the workspace; otherwise show a waiting state.
    2. Run the sequence analysis module on the loaded dataset.
    3. Populate stats, filters, and render the tables.
*/

import { initTheme } from '../ui/theme.js';
import { consumeQueuedDataset, queueDatasetForModule } from '../discovery/dataset-handoff.js';
import { runDiscovery } from '../discovery/engine.js';
import { downloadText, timestampSlug } from '../utils/export.js';
import { renderResultDetails, renderTable } from '../ui/module-view.js';
import { buildReport, FEATURE_TABLE_TITLE, featureMatrixCsv, filterResult, unavailableMessage } from './sequence-analysis-view.js';

initTheme();

const state = {
    dataset: null,
    datasetOrigin: 'default',
    result: null,
    filters: {
        search: '',
        pathogen: '',
        phenotype: '',
    },
};

const els = {
    search: document.getElementById('sa-search'),
    pathogen: document.getElementById('sa-pathogen'),
    phenotype: document.getElementById('sa-phenotype'),
    reset: document.getElementById('sa-reset'),
    statsStatus: document.getElementById('sa-stats-status'),
    tableSource: document.getElementById('sa-table-source'),
    tableStatus: document.getElementById('sa-table-status'),
    tableEmpty: document.getElementById('sa-table-empty'),
    tablesContent: document.getElementById('sa-tables-content'),
    details: document.getElementById('sa-result-details'),
    download: document.getElementById('sa-download'),
    downloadCsv: document.getElementById('sa-download-csv'),
};

let searchTimer = null;

function setStat(key, value) {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = value;
}

function setPageStatus(message) {
    if (!els.statsStatus) return;
    els.statsStatus.textContent = message || '';
    els.statsStatus.hidden = !message;
}

function renderStats(result) {
    if (!result) {
        setStat('sequences', '—');
        setStat('missing', '—');
        setStat('mean-length', '—');
        setStat('mean-pi', '—');
        setStat('mean-gravy', '—');
        return;
    }

    result.metrics.forEach((metric) => {
        const keyMap = {
            'Sequences analyzed': 'sequences',
            'Missing sequences': 'missing',
            'Mean length': 'mean-length',
            'Mean pI': 'mean-pi',
            'Mean GRAVY': 'mean-gravy',
        };
        const key = keyMap[metric.label];
        if (key) setStat(key, metric.value);
    });
}

function renderSourceNote() {
    if (!els.tableSource) return;

    if (!state.dataset) {
        els.tableSource.textContent = 'Source details appear once a dataset is loaded.';
        return;
    }

    const origin = state.datasetOrigin === 'handoff' ? 'Workspace dataset' : 'Curated dataset';
    const count = state.dataset?.effectors?.length || 0;
    els.tableSource.textContent = `${origin} · Analysis of ${count} effector(s).`;
}

function renderDetails(result) {
    if (!els.details) return;
    const markup = renderResultDetails(result);
    els.details.innerHTML = markup;
    els.details.hidden = !markup;
}

function renderTables(result) {
    if (!result || !result.tables) {
        els.tablesContent.innerHTML = '';
        return;
    }

    els.tablesContent.innerHTML = result.tables.map((table) => renderTable(table)).join('');
}

function populateSelect(select, values, allLabel) {
    if (!select) return;
    const current = select.value;
    select.replaceChildren();

    const all = document.createElement('option');
    all.value = '';
    all.textContent = allLabel;
    select.appendChild(all);

    values.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    });

    if ([...select.options].some((option) => option.value === current)) {
        select.value = current;
    }
}

function populateFilters(result) {
    if (!result || !result.tables) return;

    const featureTable = result.tables.find((t) => t.title === FEATURE_TABLE_TITLE);
    if (!featureTable) return;

    const pathogens = [...new Set(featureTable.rows.map((row) => row.pathogen).filter(Boolean))].sort();
    const phenotypes = [...new Set(featureTable.rows.map((row) => row.phenotype).filter(Boolean))].sort();

    populateSelect(els.pathogen, pathogens, 'All pathogens');
    populateSelect(els.phenotype, phenotypes, 'All phenotypes');
}

function applyFilters() {
    if (!state.result || state.result.status !== 'complete' || !state.result.tables) return;

    const filtered = filterResult(state.result, state.filters);
    renderTables(filtered);

    const featureTable = filtered.tables.find((table) => table.title === FEATURE_TABLE_TITLE);
    if (els.tableEmpty) {
        els.tableEmpty.hidden = !featureTable || featureTable.rows.length > 0;
    }
}

function clearFilters() {
    state.filters = {
        search: '',
        pathogen: '',
        phenotype: '',
    };

    if (els.search) els.search.value = '';
    if (els.pathogen) els.pathogen.value = '';
    if (els.phenotype) els.phenotype.value = '';

    applyFilters();
    els.search?.focus();
}

function bindFilters() {
    els.search?.addEventListener('input', (event) => {
        state.filters.search = event.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilters, 120);
    });

    els.pathogen?.addEventListener('change', (event) => {
        state.filters.pathogen = event.target.value;
        applyFilters();
    });

    els.phenotype?.addEventListener('change', (event) => {
        state.filters.phenotype = event.target.value;
        applyFilters();
    });

    els.reset?.addEventListener('click', clearFilters);
}

function downloadResult() {
    if (!state.result || !state.dataset) return;

    const report = buildReport(state.dataset, state.result, state.filters, state.datasetOrigin);
    downloadText(
        JSON.stringify(report, null, 2),
        `pathomap-sequence-analysis-${timestampSlug()}.json`,
        'application/json;charset=utf-8'
    );
}

function downloadFeatureMatrix() {
    if (!state.result || !state.dataset) return;

    const csv = featureMatrixCsv(state.result, state.filters, {
        origin: state.datasetOrigin,
        dataset: state.dataset,
    });
    downloadText(csv, `pathomap-sequence-features-${timestampSlug()}.csv`, 'text/csv;charset=utf-8');
}

function resetTables(message) {
    if (els.tableStatus) els.tableStatus.textContent = message;
    if (els.tableEmpty) els.tableEmpty.hidden = false;
    els.tablesContent.innerHTML = '';
    els.download.disabled = true;
    if (els.downloadCsv) els.downloadCsv.disabled = true;
    populateSelect(els.pathogen, [], 'All pathogens');
    populateSelect(els.phenotype, [], 'All phenotypes');
}

function showWaitingState() {
    renderStats(null);
    renderSourceNote();
    renderDetails(null);
    setPageStatus('No dataset on this page. Load data in the Workspace, then open this module.');
    resetTables('Waiting for data');
}

function showUnavailable(result) {
    const message = unavailableMessage(result);
    renderStats(null);
    renderSourceNote();
    renderDetails(result);
    setPageStatus(message);
    resetTables(message);
}

function showDataset(dataset) {
    state.dataset = dataset;
    state.datasetOrigin = 'handoff';

    const results = runDiscovery(dataset);
    state.result = results.modules.find((module) => module.id === 'sequence-analysis') || null;

    if (!state.result) {
        showWaitingState();
        return;
    }
    if (state.result.status !== 'complete') {
        showUnavailable(state.result);
        return;
    }

    renderStats(state.result);
    renderSourceNote();
    renderDetails(state.result);
    setPageStatus('');
    if (els.tableStatus) els.tableStatus.textContent = '';
    if (els.tableEmpty) els.tableEmpty.hidden = true;
    renderTables(state.result);
    populateFilters(state.result);
    els.download.disabled = false;
    if (els.downloadCsv) els.downloadCsv.disabled = false;
}

// Initialize
showWaitingState();

// Bind events
bindFilters();
els.download?.addEventListener('click', downloadResult);
els.downloadCsv?.addEventListener('click', downloadFeatureMatrix);

// Move the current dataset across module-page nav links, then clear it on
// arrival. This is a one-shot handoff, not a persistent cache.
document.querySelectorAll('.nav-module a').forEach((link) => {
    link.addEventListener('click', () => {
        if (state.dataset) queueDatasetForModule(state.dataset);
    });
});

// Consume queued dataset if available
const queued = consumeQueuedDataset();
if (queued) showDataset(queued);
