/*
  comparative-pathogen-analysis.js - Entry script for the Comparative Pathogen Analysis page.

  Boot:
    1. Use the one-shot dataset handed off from the workspace; otherwise show a waiting state.
    2. Run the comparative pathogen analysis module on the loaded dataset.
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
        pathogen: '',
    },
};

const els = {
    search: document.getElementById('cpa-search'),
    pathogen: document.getElementById('cpa-pathogen'),
    reset: document.getElementById('cpa-reset'),
    statsStatus: document.getElementById('cpa-stats-status'),
    tableSource: document.getElementById('cpa-table-source'),
    tableStatus: document.getElementById('cpa-table-status'),
    tableEmpty: document.getElementById('cpa-table-empty'),
    tablesContent: document.getElementById('cpa-tables-content'),
    download: document.getElementById('cpa-download'),
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
        setStat('pathogens', '—');
        setStat('effectors', '—');
        setStat('targets', '—');
        setStat('clusters', '—');
        return;
    }

    result.metrics.forEach((metric) => {
        const keyMap = {
            'Pathogens compared': 'pathogens',
            'Effectors compared': 'effectors',
            'Targeted host proteins': 'targets',
            'Effector clusters': 'clusters',
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
    const count = state.dataset?.pathogens?.length || 0;
    els.tableSource.textContent = `${origin} · Analysis of ${count} pathogen(s).`;
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
        ? `<p class="cpa-table-note">Showing first ${visible.length} of ${table.rows.length} rows.</p>`
        : '';

    return `
        <section class="cpa-table-section">
          <h4>${escapeHtml(table.title || 'Results')}</h4>
          <div class="cpa-table-wrap">
            <table class="cpa-table">
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

    const repertoireTable = result.tables.find((t) => t.title === 'Shared and unique repertoire');
    if (!repertoireTable) return;

    const pathogens = [...new Set(repertoireTable.rows.map((row) => row.pathogen).filter(Boolean))].sort();
    populateSelect(els.pathogen, pathogens, 'All pathogens');
}

function applyFilters() {
    if (!state.result || !state.result.tables) return;

    const repertoireTable = state.result.tables.find((t) => t.title === 'Shared and unique repertoire');
    if (!repertoireTable) return;

    const query = state.filters.search.trim().toLowerCase();
    const filtered = repertoireTable.rows.filter((row) => {
        const matchesSearch = !query || (
            row.pathogen?.toLowerCase().includes(query)
        );
        const matchesPathogen = !state.filters.pathogen || row.pathogen === state.filters.pathogen;
        return matchesSearch && matchesPathogen;
    });

    const filteredTable = {
        ...repertoireTable,
        rows: filtered,
    };

    const otherTables = state.result.tables.filter((t) => t.title !== 'Shared and unique repertoire');
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
        pathogen: '',
    };

    if (els.search) els.search.value = '';
    if (els.pathogen) els.pathogen.value = '';

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

    els.reset?.addEventListener('click', clearFilters);
}

function downloadResult() {
    if (!state.result || !state.dataset) return;

    const report = {
        meta: {
            generated_at: new Date().toISOString(),
            source: 'pathomap-comparative-pathogen-analysis',
            source_kind: 'dataset-handoff',
        },
        dataset: {
            pathogens_count: state.dataset.pathogens?.length || 0,
        },
        result: state.result,
    };

    downloadText(
        JSON.stringify(report, null, 2),
        `pathomap-comparative-pathogen-analysis-${timestampSlug()}.json`,
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
    populateSelect(els.pathogen, [], 'All pathogens');
}

function showDataset(dataset) {
    state.dataset = dataset;
    state.datasetOrigin = 'handoff';

    const results = runDiscovery(dataset);
    state.result = results.modules.find((module) => module.id === 'comparative-pathogen-analysis') || null;

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
