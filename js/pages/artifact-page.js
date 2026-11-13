/*
  artifact-page.js - Shared controller for Phase 6 generated-analysis pages.

  A page supplies a small config object (table columns, row projection, stats,
  search/filter predicates and optional explanatory sections). This controller
  handles loading, status/provenance, sorting, filtering and CSV export.
*/

import { initTheme } from '../ui/theme.js';
import { loadAnalysisArtifact } from '../data/analysis.js';
import {
    escapeHtml,
    exportCsv,
    formatDate,
    formatNumber,
    noticeHtml,
    renderProvenance,
    renderStats,
    renderStatus,
} from '../analysis/artifact.js';

export async function initArtifactPage(config) {
    initTheme();

    const els = {
        status: document.getElementById('analysis-status'),
        stats: document.getElementById('analysis-stats'),
        filterField: document.getElementById('analysis-filter-field'),
        filter: document.getElementById('analysis-filter'),
        search: document.getElementById('analysis-search'),
        exportButton: document.getElementById('analysis-export'),
        count: document.getElementById('analysis-count'),
        tableHead: document.getElementById('analysis-table-head'),
        tableBody: document.getElementById('analysis-table-body'),
        provenance: document.getElementById('analysis-provenance'),
        notes: document.getElementById('analysis-notes'),
        extra: document.getElementById('analysis-extra'),
        error: document.getElementById('analysis-error'),
        toolbar: document.getElementById('analysis-toolbar'),
        tableWrap: document.getElementById('analysis-table-wrap'),
    };

    let artifact = null;
    let rows = [];
    let filterValue = '';
    let searchValue = '';
    let sortKey = config.defaultSort || config.columns[0]?.key || '';
    let sortDirection = config.defaultDirection || 'asc';

    function renderTableHead() {
        if (!els.tableHead) return;
        els.tableHead.innerHTML = config.columns.map((column) => `
            <th scope="col" data-sort-key="${escapeHtml(column.key)}" tabindex="0">
                ${escapeHtml(column.label)}
                <span class="analysis-sort" aria-hidden="true">${column.key === sortKey ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}</span>
            </th>
        `).join('');

        els.tableHead.querySelectorAll('[data-sort-key]').forEach((th) => {
            const activate = () => {
                const key = th.dataset.sortKey;
                if (sortKey === key) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortKey = key;
                    sortDirection = 'asc';
                }
                renderTableHead();
                renderRows();
            };
            th.addEventListener('click', activate);
            th.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activate();
                }
            });
        });
    }

    function valueFor(row, column) {
        if (column.value) return column.value(row, artifact);
        return row[column.key];
    }

    function filteredRows() {
        const needle = searchValue.trim().toLowerCase();
        return rows.filter((row) => {
            if (config.filter && filterValue && !config.filter.predicate(row, filterValue)) return false;
            if (!needle) return true;
            return config.search(row, artifact).toLowerCase().includes(needle);
        });
    }

    function compare(a, b, column) {
        const av = valueFor(a, column);
        const bv = valueFor(b, column);
        if (av === bv) return 0;
        if (av === null || av === undefined || av === '') return 1;
        if (bv === null || bv === undefined || bv === '') return -1;
        const an = Number(av);
        const bn = Number(bv);
        if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
        return String(av).localeCompare(String(bv));
    }

    function renderRows() {
        const column = config.columns.find((item) => item.key === sortKey) || config.columns[0];
        const visible = filteredRows().sort((a, b) => compare(a, b, column) * (sortDirection === 'asc' ? 1 : -1));

        if (els.count) {
            els.count.textContent = `${formatNumber(visible.length)} of ${formatNumber(rows.length)} rows`;
        }

        if (!visible.length) {
            els.tableBody.innerHTML = `
                <tr>
                    <td class="analysis-empty" colspan="${config.columns.length}">
                        ${escapeHtml(config.emptyMessage || 'No rows match the active filter.')}
                    </td>
                </tr>
            `;
            return;
        }

        els.tableBody.innerHTML = visible.map((row) => `
            <tr>
                ${config.columns.map((item) => `
                    <td class="${escapeHtml(item.className || '')}">
                        ${item.render ? item.render(row, artifact) : escapeHtml(valueFor(row, item))}
                    </td>
                `).join('')}
            </tr>
        `).join('');
    }

    function wireControls() {
        if (config.filter && els.filter && els.filterField) {
            const options = config.filter.options(artifact);
            els.filter.innerHTML = [
                `<option value="">${escapeHtml(config.filter.allLabel || 'All')}</option>`,
                ...options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`),
            ].join('');
            els.filterField.hidden = false;
            els.filter.addEventListener('change', () => {
                filterValue = els.filter.value;
                renderRows();
            });
        }

        if (els.search) {
            els.search.placeholder = config.searchPlaceholder || 'Search…';
            els.search.addEventListener('input', () => {
                searchValue = els.search.value;
                renderRows();
            });
        }

        if (els.exportButton) {
            els.exportButton.addEventListener('click', () => {
                const visible = filteredRows().sort((a, b) => {
                    const column = config.columns.find((item) => item.key === sortKey) || config.columns[0];
                    return compare(a, b, column) * (sortDirection === 'asc' ? 1 : -1);
                });
                exportCsv(config.columns, visible, config.csvName || config.title, {
                    analysis: config.title,
                    generated_at: artifact?.meta?.generated_at,
                    dataset_sha256: artifact?.meta?.source_dataset_sha256,
                });
            });
        }
    }

    function renderError(error) {
        if (els.toolbar) els.toolbar.hidden = true;
        if (els.tableWrap) els.tableWrap.hidden = true;
        if (els.stats) els.stats.hidden = true;
        if (els.status) els.status.hidden = true;
        if (els.error) {
            els.error.hidden = false;
            els.error.innerHTML = noticeHtml(
                `<strong>Analysis artifact not available.</strong> ${escapeHtml(error.message)}
                 <br>Generate it with <code>${escapeHtml(config.command)}</code>, then reload this page.`,
                'warn'
            );
        }
        if (els.provenance) els.provenance.innerHTML = '';
        if (els.notes) els.notes.innerHTML = '';
        if (els.extra) els.extra.innerHTML = '';
    }

    try {
        artifact = await loadAnalysisArtifact(config.artifact);
    } catch (error) {
        renderError(error);
        return;
    }

    rows = config.rows(artifact);

    if (els.status) els.status.innerHTML = renderStatus(artifact);
    if (els.stats) els.stats.innerHTML = renderStats(config.stats(artifact));
    if (els.notes) els.notes.innerHTML = config.note ? config.note(artifact) : '';
    if (els.extra) els.extra.innerHTML = config.extra ? config.extra(artifact) : '';
    if (els.provenance) els.provenance.innerHTML = renderProvenance(artifact);

    renderTableHead();
    wireControls();
    renderRows();
}

export function number(value, digits = 0) {
    return formatNumber(value, digits);
}

export function date(value) {
    return formatDate(value);
}
