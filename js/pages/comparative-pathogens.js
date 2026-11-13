import { initArtifactPage, number } from './artifact-page.js';
import { escapeHtml, formatNumber, noticeHtml } from '../analysis/artifact.js';

function namesById(artifact) {
    return new Map((artifact.pathogens || []).map((pathogen) => [pathogen.pathogen_id, pathogen.pathogen_name]));
}

initArtifactPage({
    title: 'Comparative Pathogen Analysis',
    artifact: 'comparativePathogens',
    command: 'python scripts/analyze_comparative_pathogens.py',
    csvName: 'comparative-pathogen-analysis',
    searchPlaceholder: 'Search pathogen or strategy…',
    defaultSort: 'effector_count',
    defaultDirection: 'desc',
    filter: {
        allLabel: 'All pathogens',
        options: () => [
            { value: 'eligible', label: 'Eligible for clustering' },
            { value: 'excluded', label: 'Excluded (too few effectors)' },
        ],
        predicate: (row, value) => value === 'eligible' ? row.eligible_for_clustering : !row.eligible_for_clustering,
    },
    stats: (artifact) => {
        const s = artifact.statistics;
        return [
            { label: 'Pathogens', value: number(s.pathogen_count), detail: `${formatNumber(s.eligible_pathogen_count)} eligible` },
            { label: 'Effectors', value: number(s.effector_count) },
            { label: 'Shared domains', value: number(s.shared_domain_count) },
            { label: 'Shared host targets', value: number(s.shared_host_target_count) },
        ];
    },
    rows: (artifact) => artifact.pathogens || [],
    search: (row) => `${row.pathogen_name} ${row.strategy} ${row.pathogen_id}`,
    columns: [
        { key: 'pathogen_name', label: 'Pathogen', render: (row) => `<strong>${escapeHtml(row.pathogen_name)}</strong>` },
        { key: 'strategy', label: 'Survival strategy', render: (row) => `<span class="analysis-tag">${escapeHtml(row.strategy || '—')}</span>` },
        { key: 'effector_count', label: 'Effectors', value: (row) => row.effector_count, render: (row) => number(row.effector_count) },
        { key: 'unique_effector_name_count', label: 'Unique names', value: (row) => row.unique_effector_name_count, render: (row) => number(row.unique_effector_name_count) },
        { key: 'domain_family_count', label: 'Domain families', value: (row) => row.domain_family_count, render: (row) => number(row.domain_family_count) },
        { key: 'host_target_count', label: 'Host targets', value: (row) => row.host_target_count, render: (row) => number(row.host_target_count) },
        { key: 'go_term_count', label: 'GO terms', value: (row) => row.go_term_count, render: (row) => number(row.go_term_count) },
        {
            key: 'genome_size_mb',
            label: 'Genome (Mb)',
            value: (row) => row.genome_size_mb,
            render: (row) => row.genome_size_mb == null ? '—' : number(row.genome_size_mb, 2),
        },
        {
            key: 'eligible_for_clustering',
            label: 'Eligible',
            value: (row) => (row.eligible_for_clustering ? 'yes' : 'no'),
            render: (row) => `<span class="analysis-flag analysis-flag--${row.eligible_for_clustering ? 'ok' : 'neutral'}">${row.eligible_for_clustering ? 'Yes' : 'No'}</span>`,
        },
        {
            key: 'type_classes',
            label: 'Effector types',
            value: (row) => Object.entries(row.type_classes || {}).map(([key, value]) => `${key} (${value})`).join('; '),
            render: (row) => escapeHtml(Object.entries(row.type_classes || {}).map(([key, value]) => `${key} (${value})`).join('; ') || '—'),
        },
    ],
    note: (artifact) => {
        const s = artifact.statistics;
        return noticeHtml(
            `Comparative dimensions use Jaccard similarity over effector names, annotated domain families, curated host targets, and effector type classes. `
            + `Average-linkage clustering includes ${formatNumber(s.eligible_pathogen_count)} pathogens; ${formatNumber(s.excluded_pathogen_count)} with too few effectors are excluded. `
            + `Shared domains require the same annotated family or accession and do not establish homology.`,
            'info'
        );
    },
    extra: (artifact) => {
        const names = namesById(artifact);
        const pairs = [...(artifact.similarity?.domain_families?.pairs || [])]
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 10);
        return `
            <div class="analysis-extra-grid">
                <div class="ia-panel">
                    <div class="ia-panel-header"><h3>Most similar pathogen pairs</h3><span class="ia-panel-note">Domain families</span></div>
                    <div class="analysis-table-wrap">
                        <table class="db-table analysis-table">
                            <thead><tr><th>Pair</th><th>Jaccard</th></tr></thead>
                            <tbody>
                                ${pairs.map((pair) => `
                                    <tr>
                                        <td>${escapeHtml(names.get(pair.left_pathogen_id))} vs ${escapeHtml(names.get(pair.right_pathogen_id))}</td>
                                        <td>${number(pair.similarity, 3)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="ia-panel">
                    <div class="ia-panel-header"><h3>Most shared host targets</h3><span class="ia-panel-note">Across pathogens</span></div>
                    <div class="analysis-table-wrap">
                        <table class="db-table analysis-table">
                            <thead><tr><th>Host target</th><th>Pathogens</th></tr></thead>
                            <tbody>
                                ${(artifact.shared_host_targets || []).slice(0, 10).map((target) => `
                                    <tr>
                                        <td>${escapeHtml(target.protein_name)}<br><span class="analysis-muted">${escapeHtml(target.gene_name || target.host_protein_id)}</span></td>
                                        <td>${number(target.pathogen_count)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    },
});
