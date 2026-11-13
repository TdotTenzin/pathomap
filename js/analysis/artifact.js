/*
  artifact.js - Shared rendering helpers for generated analysis pages.

  Keeps number formatting, escaping, status labels, provenance and small table
  builders consistent across the five Phase 6 analysis pages.
*/

import { downloadText, toCsv, timestampSlug } from '../utils/export.js';

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function formatNumber(value, digits = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

export function formatP(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    if (number === 0) return '< 0.0001';
    if (number < 0.001) return number.toExponential(2);
    return number.toFixed(4);
}

export function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function statusLabel(status) {
    const labels = {
        complete: 'Complete',
        low_power: 'Low power',
        insufficient_data: 'Insufficient data',
        failed: 'Failed',
    };
    return labels[status] || status || 'Unknown';
}

export function statusTone(status) {
    if (status === 'complete') return 'ok';
    if (status === 'low_power') return 'warn';
    return 'bad';
}

export function noticeHtml(message, tone = 'info') {
    if (!message) return '';
    return `<div class="analysis-notice analysis-notice--${escapeHtml(tone)}">${message}</div>`;
}

export function renderStatus(artifact) {
    const status = artifact?.status || 'unknown';
    const reasons = artifact?.status_reasons || [];
    const warnings = artifact?.warnings || [];
    const details = [...reasons, ...warnings];
    return `
        <span class="analysis-status-pill analysis-status-pill--${statusTone(status)}">${escapeHtml(statusLabel(status))}</span>
        ${details.length ? `<span class="analysis-status-detail">${details.map(escapeHtml).join(' · ')}</span>` : ''}
    `;
}

export function renderProvenance(artifact) {
    const meta = artifact?.meta || {};
    const validation = artifact?.validation || {};
    const issues = validation.issues || [];
    const rows = [
        ['Analysis', meta.analysis],
        ['Version', meta.analysis_version || artifact?.schema_version],
        ['Generated', formatDate(meta.generated_at)],
        ['Dataset built', formatDate(meta.source_dataset_built_at)],
        ['Dataset schema', meta.source_dataset_schema_version],
        ['Dataset SHA-256', meta.source_dataset_sha256 ? `${String(meta.source_dataset_sha256).slice(0, 16)}…` : null],
        ['Source path', meta.source_dataset_path],
        ['Validation issues', issues.length ? `${issues.length} reported` : 'None reported'],
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');

    return `
        <details class="analysis-provenance">
            <summary>Provenance and validation</summary>
            <dl class="analysis-provenance-list">
                ${rows.map(([label, value]) => `
                    <div>
                        <dt>${escapeHtml(label)}</dt>
                        <dd>${escapeHtml(value)}</dd>
                    </div>
                `).join('')}
            </dl>
            ${issues.length ? `
                <ul class="analysis-provenance-issues">
                    ${issues.slice(0, 20).map((issue) => `<li>${escapeHtml(issue.message || issue.code || String(issue))}</li>`).join('')}
                </ul>
            ` : ''}
        </details>
    `;
}

export function renderStats(stats) {
    return stats.map(({ label, value, detail }) => `
        <div class="ia-stat">
            <span class="ia-stat-value">${escapeHtml(value)}</span>
            <span class="ia-stat-label">${escapeHtml(label)}</span>
            ${detail ? `<span class="analysis-stat-detail">${escapeHtml(detail)}</span>` : ''}
        </div>
    `).join('');
}

export function exportCsv(columns, rows, filename, metadata = {}) {
    const headerNote = Object.entries(metadata)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `# ${key}: ${value}`)
        .join('\n');
    const csv = toCsv(
        columns.map((column) => ({ key: column.key, label: column.label })),
        rows.map((row) => Object.fromEntries(
            columns.map((column) => [
                column.key,
                column.csv ? column.csv(row) : column.value ? column.value(row) : row[column.key],
            ])
        ))
    );
    downloadText(
        headerNote ? `${headerNote}\n${csv}` : csv,
        `${filename}-${timestampSlug()}.csv`,
        'text/csv;charset=utf-8'
    );
}
