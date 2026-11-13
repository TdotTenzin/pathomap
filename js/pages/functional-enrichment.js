import { initArtifactPage, number } from './artifact-page.js';
import { escapeHtml, formatP, formatNumber, noticeHtml } from '../analysis/artifact.js';

initArtifactPage({
    title: 'Functional Enrichment',
    artifact: 'functionalEnrichment',
    command: 'python scripts/analyze_functional_enrichment.py',
    csvName: 'functional-enrichment',
    searchPlaceholder: 'Search GO term or accession…',
    defaultSort: 'p_value',
    filter: {
        allLabel: 'All GO aspects',
        options: (artifact) => Object.values(artifact.aspects || {}).map((aspect) => ({
            value: aspect.aspect,
            label: aspect.aspect_name,
        })),
        predicate: (row, value) => row.aspect === value,
    },
    stats: (artifact) => {
        const s = artifact.statistics;
        return [
            { label: 'Foreground', value: number(s.mapped_foreground_protein_count), detail: `${formatNumber(s.foreground_protein_count)} targeted` },
            { label: 'Background', value: number(s.background_protein_count) },
            { label: 'GO terms tested', value: number(s.tested_term_count) },
            { label: 'Significant', value: number(s.significant_term_count), detail: 'BH q < 0.05' },
        ];
    },
    rows: (artifact) => artifact.terms || [],
    search: (row) => `${row.term_id} ${row.term_name} ${row.aspect_name}`,
    columns: [
        {
            key: 'term_name',
            label: 'GO term',
            render: (row) => `<strong>${escapeHtml(row.term_name)}</strong><br><span class="analysis-muted">${escapeHtml(row.term_id)}</span>`,
        },
        {
            key: 'aspect_name',
            label: 'Aspect',
            render: (row) => `<span class="analysis-tag">${escapeHtml(row.aspect_name)}</span>`,
        },
        {
            key: 'input_count',
            label: 'Foreground',
            value: (row) => row.input_count,
            render: (row) => `${number(row.input_count)} / ${number(row.input_total)}`,
        },
        {
            key: 'background_count',
            label: 'Background',
            value: (row) => row.background_count,
            render: (row) => `${number(row.background_count)} / ${number(row.background_total)}`,
        },
        { key: 'fold_enrichment', label: 'Fold', value: (row) => row.fold_enrichment, render: (row) => number(row.fold_enrichment, 2) },
        { key: 'p_value', label: 'P value', value: (row) => row.p_value, render: (row) => formatP(row.p_value) },
        { key: 'q_value', label: 'BH q', value: (row) => row.q_value, render: (row) => formatP(row.q_value) },
        {
            key: 'significant',
            label: 'Significant',
            value: (row) => (row.significant ? 'yes' : 'no'),
            render: (row) => `<span class="analysis-flag analysis-flag--${row.significant ? 'ok' : 'neutral'}">${row.significant ? 'Yes' : 'No'}</span>`,
        },
    ],
    note: (artifact) => {
        const s = artifact.statistics;
        const noHits = s.significant_term_count === 0;
        return noticeHtml(
            `Foreground: ${formatNumber(s.mapped_foreground_protein_count)} host proteins targeted by curated effectors. `
            + `Background: ${formatNumber(s.background_protein_count)} annotated host proteins. `
            + `Benjamini–Hochberg correction is applied within each GO aspect. `
            + (noHits ? 'No term passes q < 0.05; with this small background, absence of significant terms is expected and should not be read as absence of biology.' : ''),
            noHits ? 'warn' : 'info'
        );
    },
    extra: (artifact) => `
        <div class="ia-panel">
            <div class="ia-panel-header"><h3>Aspect summary</h3><span class="ia-panel-note">BH per aspect</span></div>
            <div class="analysis-table-wrap">
                <table class="db-table analysis-table">
                    <thead><tr><th>Aspect</th><th>Foreground</th><th>Background</th><th>Terms tested</th><th>Significant</th></tr></thead>
                    <tbody>
                        ${Object.values(artifact.aspects || {}).map((aspect) => `
                            <tr>
                                <td>${escapeHtml(aspect.aspect_name)}</td>
                                <td>${number(aspect.foreground_total)}</td>
                                <td>${number(aspect.background_total)}</td>
                                <td>${number(aspect.tested_term_count)}</td>
                                <td>${number(aspect.significant_term_count)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `,
});
