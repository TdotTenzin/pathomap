/*
  predictive-readiness.js - Entry script for the Prediction Readiness page.

  Boot:
    1. Use the one-shot dataset handed off from the workspace; otherwise show a waiting state.
    2. Run the predictive readiness module on the loaded dataset.
    3. Populate stats, filters, and render the readiness checklist.
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
        passed: '',
    },
};

const els = {
    search: document.getElementById('pr-search'),
    passed: document.getElementById('pr-passed'),
    reset: document.getElementById('pr-reset'),
    statsStatus: document.getElementById('pr-stats-status'),
    tableSource: document.getElementById('pr-table-source'),
    tableStatus: document.getElementById('pr-table-status'),
    tableEmpty: document.getElementById('pr-table-empty'),
    tablesContent: document.getElementById('pr-tables-content'),
    download: document.getElementById('pr-download'),
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
        setStat('readiness', '—');
        setStat('labelled', '—');
        setStat('completeness', '—');
        setStat('checks-passed', '—');
        return;
    }

    result.metrics.forEach((metric) => {
        const keyMap = {
            'Readiness': 'readiness',
            'Labelled effectors': 'labelled',
            'Feature completeness': 'completeness',
            'Checks passed': 'checks-passed',
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
    els.tableSource.textContent = `${origin} · Readiness assessment of ${count} effector(s).`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderTable(table, maxRows = 100) {
    const visible = (table.rows || []).slice(0, maxRows);
    const header = (table.columns || []).map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join('');
    const body = visible.map((row) => {
        const cells = (table.columns || []).map((column) => {
            const value = row[column.key] ?? '—';
            const cls = column.key === 'passed' ? `pr-check-${row.passed}` : '';
            return `<td class="${cls}">${escapeHtml(value)}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');
    const truncated = (table.rows || []).length > visible.length
        ? `<p class="pr-table-note">Showing first ${visible.length} of ${table.rows.length} rows.</p>`
        : '';

    return `
        <section class="pr-table-section">
          <h4>${escapeHtml(table.title || 'Results')}</h4>
          <div class="pr-table-wrap">
            <table class="pr-table">
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

function populateFilters() {
    // Passed filter has fixed options - nothing to populate dynamically
}

function applyFilters() {
    if (!state.result || !state.result.tables) return;

    const primaryTable = state.result.tables[0];
    if (!primaryTable) return;

    const query = state.filters.search.trim().toLowerCase();
    const filtered = primaryTable.rows.filter((row) => {
        const matchesSearch = !query || (
            row.check?.toLowerCase().includes(query) ||
            row.value?.toLowerCase().includes(query) ||
            row.requirement?.toLowerCase().includes(query)
        );
        const matchesPassed = !state.filters.passed || row.passed === state.filters.passed;
        return matchesSearch && matchesPassed;
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
        passed: '',
    };

    if (els.search) els.search.value = '';
    if (els.passed) els.passed.value = '';

    applyFilters();
    els.search?.focus();
}

function bindFilters() {
    els.search?.addEventListener('input', (event) => {
        state.filters.search = event.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilters, 120);
    });

    els.passed?.addEventListener('change', (event) => {
        state.filters.passed = event.target.value;
        applyFilters();
    });

    els.reset?.addEventListener('click', clearFilters);
}

function downloadResult() {
    if (!state.result || !state.dataset) return;

    const report = {
        meta: {
            generated_at: new Date().toISOString(),
            source: 'pathomap-predictive-readiness',
            source_kind: 'dataset-handoff',
        },
        dataset: {
            effectors_count: state.dataset.effectors?.length || 0,
        },
        result: state.result,
    };

    downloadText(
        JSON.stringify(report, null, 2),
        `pathomap-predictive-readiness-${timestampSlug()}.json`,
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
}

function showDataset(dataset) {
    state.dataset = dataset;
    state.datasetOrigin = 'handoff';

    const results = runDiscovery(dataset);
    state.result = results.modules.find((module) => module.id === 'predictive-readiness') || null;

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
    populateFilters();
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
