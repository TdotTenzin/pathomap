import { initArtifactPage, number } from './artifact-page.js';
import { escapeHtml, formatP, formatNumber, noticeHtml } from '../analysis/artifact.js';

initArtifactPage({
    title: 'Pathway Analysis',
    artifact: 'pathways',
    command: 'python scripts/analyze_pathways.py',
    csvName: 'pathway-analysis',
    searchPlaceholder: 'Search pathway, accession, or database…',
    defaultSort: 'p_value',
    filter: {
        allLabel: 'All databases',
        options: () => [
            { value: 'Reactome', label: 'Reactome' },
            { value: 'KEGG', label: 'KEGG' },
        ],
        predicate: (row, value) => row.database === value,
    },
    stats: (artifact) => {
        const s = artifact.statistics;
        return [
            { label: 'Pathways', value: number(s.pathway_count), detail: `${formatNumber(s.reactome_pathway_count)} Reactome · ${formatNumber(s.kegg_pathway_count)} KEGG` },
            { label: 'Reactome tested', value: number(s.reactome_tested_count), detail: `${formatNumber(s.reactome_significant_count)} significant` },
            { label: 'KEGG tested', value: number(s.kegg_tested_count), detail: `${formatNumber(s.kegg_significant_count)} significant` },
            { label: 'KEGG genes mapped', value: `${number(s.kegg_resolved_gene_count)} / ${number(s.kegg_gene_id_count)}` },
        ];
    },
    rows: (artifact) => [
        ...(artifact.enrichment?.Reactome?.pathways || []),
        ...(artifact.enrichment?.KEGG?.pathways || []),
    ],
    search: (row) => `${row.pathway_id} ${row.pathway_name} ${row.database}`,
    columns: [
        {
            key: 'pathway_name',
            label: 'Pathway',
            render: (row) => `<strong>${escapeHtml(row.pathway_name)}</strong><br><span class="analysis-muted">${escapeHtml(row.pathway_id)}</span>`,
        },
        {
            key: 'database',
            label: 'Database',
            render: (row) => `<span class="analysis-tag">${escapeHtml(row.database)}</span>`,
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
        const significant = (s.reactome_significant_count || 0) + (s.kegg_significant_count || 0);
        const significanceNote = significant === 0
            ? 'No pathway passes BH q < 0.05.'
            : `${formatNumber(significant)} pathway(s) pass BH q < 0.05.`;
        return noticeHtml(
            `Reactome memberships come from curated host-protein annotations. Stored KEGG values are gene IDs, mapped to pathways through KEGG REST; `
            + `${formatNumber(s.kegg_resolved_gene_count)} of ${formatNumber(s.kegg_gene_id_count)} genes resolved. `
            + `${significanceNote} Reactome foreground ${formatNumber(artifact.enrichment?.Reactome?.foreground_total)} / background ${formatNumber(artifact.enrichment?.Reactome?.background_total)}; `
            + `KEGG foreground ${formatNumber(artifact.enrichment?.KEGG?.foreground_total)} / background ${formatNumber(artifact.enrichment?.KEGG?.background_total)}.`,
            'info'
        );
    },
    extra: (artifact) => {
        const unresolved = artifact.kegg_mapping?.unresolved_genes || [];
        return `
            <div class="ia-panel">
                <div class="ia-panel-header"><h3>KEGG gene mapping</h3><span class="ia-panel-note">${unresolved.length} unresolved</span></div>
                <div class="analysis-table-wrap">
                    <table class="db-table analysis-table">
                        <thead><tr><th>Gene ID</th><th>Status</th></tr></thead>
                        <tbody>
                            ${(artifact.kegg_mapping?.resolved_gene_ids || []).slice(0, 10).map((gene) => `
                                <tr><td>${escapeHtml(gene)}</td><td>mapped</td></tr>
                            `).join('')}
                            ${unresolved.map((item) => `
                                <tr><td>${escapeHtml(item.gene_id)}</td><td>${escapeHtml(item.reason)}</td></tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ${(artifact.kegg_mapping?.resolved_gene_ids || []).length > 10 ? `<p class="analysis-table-footnote">Showing 10 of ${formatNumber(artifact.kegg_mapping.resolved_gene_ids.length)} mapped genes; export for the full pathway table.</p>` : ''}
                </div>
            </div>
        `;
    },
});
