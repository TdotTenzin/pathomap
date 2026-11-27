/*
  functional-enrichment.js - Entry script for the Functional Enrichment page.

  Boot:
    1. Use the one-shot dataset handed off from the workspace; otherwise show a waiting state.
    2. Run the functional enrichment module on the loaded dataset.
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
        pathway: '',
        significant: '',
    },
};

const els = {
    search: document.getElementById('fe-search'),
    pathway: document.getElementById('fe-pathway'),
    significant: document.getElementById('fe-significant'),
    reset: document.getElementById('fe-reset'),
    statsStatus: document.getElementById('fe-stats-status'),
    tableSource: document.getElementById('fe-table-source'),
    tableStatus: document.getElementById('fe-table-status'),
    tableEmpty: document.getElementById('fe-table-empty'),
    tablesContent: document.getElementById('fe-tables-content'),
    download: document.getElementById('fe-download'),
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
        setStat('background', '—');
        setStat('query', '—');
        setStat('terms', '—');
        setStat('significant', '—');
        return;
    }

    result.metrics.forEach((metric) => {
        const keyMap = {
            'Background proteins': 'background',
            'Query proteins': 'query',
            'Terms tested': 'terms',
            'Significant after FDR': 'significant',
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
    const count = state.dataset?.host_proteins?.length || 0;
    els.tableSource.textContent = `${origin} · Analysis of ${count} host protein(s).`;
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
        ? `<p class="fe-table-note">Showing first ${visible.length} of ${table.rows.length} rows.</p>`
        : '';

    return `
        <section class="fe-table-section">
          <h4>${escapeHtml(table.title || 'Results')}</h4>
          <div class="fe-table-wrap">
            <table class="fe-table">
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

    const primaryTable = result.tables[0];
    if (!primaryTable) return;

    const pathways = [...new Set(primaryTable.rows.map((row) => row.pathway).filter(Boolean))].sort();
    populateSelect(els.pathway, pathways, 'All pathways');
}

function applyFilters() {
    if (!state.result || !state.result.tables) return;

    const primaryTable = state.result.tables[0];
    if (!primaryTable) return;

    const query = state.filters.search.trim().toLowerCase();
    const filtered = primaryTable.rows.filter((row) => {
        const matchesSearch = !query || (
            row.pathway?.toLowerCase().includes(query) ||
            row.contributing_proteins?.toLowerCase().includes(query)
        );
        const matchesPathway = !state.filters.pathway || row.pathway === state.filters.pathway;
        const matchesSignificant = !state.filters.significant || row.significant === state.filters.significant;
        return matchesSearch && matchesPathway && matchesSignificant;
    });

    const filteredTable = {
        ...primaryTable,
        rows: filtered,
    };

    const filteredResult = {
        ...state.result,
        tables: [filteredTable],
    };

    renderTables(filteredResult);

    if (els.tableEmpty) {
        els.tableEmpty.hidden = filtered.length > 0;
    }
}

function clearFilters() {
    state.filters = {
        search: '',
        pathway: '',
        significant: '',
    };

    if (els.search) els.search.value = '';
    if (els.pathway) els.pathway.value = '';
    if (els.significant) els.significant.value = '';

    applyFilters();
    els.search?.focus();
}

function bindFilters() {
    els.search?.addEventListener('input', (event) => {
        state.filters.search = event.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilters, 120);
    });

    els.pathway?.addEventListener('change', (event) => {
        state.filters.pathway = event.target.value;
        applyFilters();
    });

    els.significant?.addEventListener('change', (event) => {
        state.filters.significant = event.target.value;
        applyFilters();
    });

    els.reset?.addEventListener('click', clearFilters);
}

function downloadResult() {
    if (!state.result || !state.dataset) return;

    const report = {
        meta: {
            generated_at: new Date().toISOString(),
            source: 'pathomap-functional-enrichment',
            source_kind: 'dataset-handoff',
        },
        dataset: {
            host_proteins_count: state.dataset.host_proteins?.length || 0,
        },
        result: state.result,
    };

    downloadText(
        JSON.stringify(report, null, 2),
        `pathomap-functional-enrichment-${timestampSlug()}.json`,
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
    populateSelect(els.pathway, [], 'All pathways');
}

function showDataset(dataset) {
    state.dataset = dataset;
    state.datasetOrigin = 'handoff';

    const results = runDiscovery(dataset);
    state.result = results.modules.find((module) => module.id === 'functional-enrichment') || null;

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
