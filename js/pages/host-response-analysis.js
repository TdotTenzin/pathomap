/*
  host-response-analysis.js - Entry script for the Host Response Analysis page.

  Boot:
    1. Use the one-shot dataset handed off from the workspace; otherwise show a waiting state.
    2. Run the host response analysis module on the loaded dataset.
    3. Populate stats, filters, and render the tables.
*/

import { initTheme } from '../ui/theme.js';
import { consumeQueuedDataset, queueDatasetForModule } from '../discovery/dataset-handoff.js';
import { runDiscovery } from '../discovery/engine.js';
import { downloadText, timestampSlug } from '../utils/export.js';
import { pluralize } from '../utils/format.js';

initTheme();

const state = {
    dataset: null,
    datasetOrigin: 'default',
    result: null,
    filteredRows: [],
    filters: {
        search: '',
        process: '',
    },
};

const els = {
    search: document.getElementById('hra-search'),
    process: document.getElementById('hra-process'),
    reset: document.getElementById('hra-reset'),
    statsStatus: document.getElementById('hra-stats-status'),
    tableSource: document.getElementById('hra-table-source'),
    tableStatus: document.getElementById('hra-table-status'),
    tableEmpty: document.getElementById('hra-table-empty'),
    tablesContent: document.getElementById('hra-tables-content'),
    download: document.getElementById('hra-download'),
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
        setStat('processes', '—');
        setStat('proteins', '—');
        setStat('mechanisms', '—');
        return;
    }

    result.metrics.forEach((metric) => {
        const keyMap = {
            'Processes represented': 'processes',
            'Effector-linked proteins': 'proteins',
            'Mechanisms recorded': 'mechanisms',
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
    const count = state.dataset?.interactions?.length || 0;
    els.tableSource.textContent = `${origin} · Analysis of ${count} interaction(s).`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderTable(table, maxRows = 100) {
    const visible = (table.rows || []).slice(0, maxRows);
    const header = (table.columns || []).map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join('');
    const body = visible.map((row) => `
        <tr>${(table.columns || []).map((column) => `<td>${escapeHtml(row[column.key] ?? '—')}</td>`).join('')}</tr>
    `).join('');
    const truncated = (table.rows || []).length > visible.length
        ? `<p class="hra-table-note">Showing first ${visible.length} of ${table.rows.length} rows.</p>`
        : '';

    return `
        <section class="hra-table-section">
          <h4>${escapeHtml(table.title || 'Results')}</h4>
          <div class="hra-table-wrap">
            <table class="hra-table">
              <thead><tr>${header}</tr></thead>
              <tbody>${body}</tbody>
            </table>
          </div>
          ${truncated}
        </section>
    `;
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

    const processTable = result.tables.find((t) => t.title === 'Affected processes');
    if (!processTable) return;

    const processes = [...new Set(processTable.rows.map((row) => row.process).filter(Boolean))].sort();
    populateSelect(els.process, processes, 'All processes');
}

function applyFilters() {
    if (!state.result || !state.result.tables) return;

    const processTable = state.result.tables.find((t) => t.title === 'Affected processes');
    if (!processTable) return;

    const query = state.filters.search.trim().toLowerCase();
    const filtered = processTable.rows.filter((row) => {
        const matchesSearch = !query || (
            row.process?.toLowerCase().includes(query) ||
            row.pathogen_names?.toLowerCase().includes(query)
        );
        const matchesProcess = !state.filters.process || row.process === state.filters.process;
        return matchesSearch && matchesProcess;
    });

    const filteredTable = {
        ...processTable,
        rows: filtered,
    };

    const otherTables = state.result.tables.filter((t) => t.title !== 'Affected processes');
    const filteredResult = {
        ...state.result,
        tables: [filteredTable, ...otherTables],
    };

    renderTables(filteredResult);

    if (els.tableEmpty) {
        els.tableEmpty.hidden = filtered.length > 0;
    }
}

function clearFilters() {
    state.filters = {
        search: '',
        process: '',
    };

    if (els.search) els.search.value = '';
    if (els.process) els.process.value = '';

    applyFilters();
    els.search?.focus();
}

function bindFilters() {
    els.search?.addEventListener('input', (event) => {
        state.filters.search = event.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilters, 120);
    });

    els.process?.addEventListener('change', (event) => {
        state.filters.process = event.target.value;
        applyFilters();
    });

    els.reset?.addEventListener('click', clearFilters);
}

function downloadResult() {
    if (!state.result || !state.dataset) return;

    const report = {
        meta: {
            generated_at: new Date().toISOString(),
            source: 'pathomap-host-response-analysis',
            source_kind: 'dataset-handoff',
        },
        dataset: {
            interactions_count: state.dataset.interactions?.length || 0,
        },
        result: state.result,
    };

    downloadText(
        JSON.stringify(report, null, 2),
        `pathomap-host-response-analysis-${timestampSlug()}.json`,
        'application/json;charset=utf-8'
    );
}

function showWaitingState() {
    renderStats(null);
    renderSourceNote();
    setPageStatus('No dataset on this page. Load data in the Workspace, then open this module.');
    if (els.tableStatus) els.tableStatus.textContent = 'Waiting for data';
    if (els.tableEmpty) els.tableEmpty.hidden = false;
    els.tablesContent.innerHTML = '';
    els.download.disabled = true;
    populateSelect(els.process, [], 'All processes');
}

function showDataset(dataset) {
    state.dataset = dataset;
    state.datasetOrigin = 'handoff';

    const results = runDiscovery(dataset);
    state.result = results.modules.find((module) => module.id === 'host-response-analysis') || null;

    if (!state.result || state.result.status !== 'complete') {
        showWaitingState();
        return;
    }

    renderStats(state.result);
    renderSourceNote();
    setPageStatus('');
    if (els.tableStatus) els.tableStatus.textContent = '';
    if (els.tableEmpty) els.tableEmpty.hidden = true;
    renderTables(state.result);
    populateFilters(state.result);
    els.download.disabled = false;
}

// Initialize
showWaitingState();

// Bind events
bindFilters();
els.download?.addEventListener('click', downloadResult);

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
