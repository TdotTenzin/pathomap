import { initArtifactPage, number } from './artifact-page.js';
import { escapeHtml, formatNumber, noticeHtml } from '../analysis/artifact.js';

function hubIds(artifact) {
    return new Set((artifact.hubs || []).map((hub) => hub.id));
}

initArtifactPage({
    title: 'Protein Network Analysis',
    artifact: 'proteinNetwork',
    command: 'python scripts/analyze_protein_network.py',
    csvName: 'protein-network-nodes',
    searchPlaceholder: 'Search protein, gene, or UniProt ID…',
    defaultSort: 'degree',
    defaultDirection: 'desc',
    filter: {
        allLabel: 'All host proteins',
        options: (artifact) => [
            { value: 'connected', label: 'With STRING interaction' },
            { value: 'hubs', label: `Hubs (${formatNumber(artifact.hubs?.length)})` },
            { value: 'targeted', label: 'Targeted by an effector' },
        ],
        predicate: (row, value) => {
            if (value === 'connected') return row.degree > 0;
            if (value === 'hubs') return hubIds(artifact).has(row.id);
            if (value === 'targeted') return row.effector_target_degree > 0;
            return true;
        },
    },
    stats: (artifact) => {
        const s = artifact.statistics;
        return [
            { label: 'Host proteins', value: number(s.host_node_count), detail: `${formatNumber(s.host_nodes_with_host_edges)} with host edges` },
            { label: 'STRING edges', value: number(s.host_host_edge_count), detail: 'combined score ≥ 700' },
            { label: 'Effector–host edges', value: number(s.effector_host_edge_count) },
            { label: 'Hubs', value: number(s.hub_count), detail: `${formatNumber(s.component_count)} components` },
        ];
    },
    rows: (artifact) => artifact.nodes || [],
    search: (row) => `${row.label} ${row.gene_name} ${row.uniprot_id} ${row.id}`,
    columns: [
        {
            key: 'label',
            label: 'Protein',
            render: (row) => `<strong>${escapeHtml(row.label)}</strong><br><span class="analysis-muted">${escapeHtml(row.id)}</span>`,
        },
        { key: 'gene_name', label: 'Gene', render: (row) => escapeHtml(row.gene_name || '—') },
        { key: 'uniprot_id', label: 'UniProt', render: (row) => escapeHtml(row.uniprot_id || '—') },
        { key: 'degree', label: 'Degree', value: (row) => row.degree, render: (row) => number(row.degree) },
        { key: 'weighted_degree', label: 'Weighted degree', value: (row) => row.weighted_degree, render: (row) => number(row.weighted_degree, 2) },
        { key: 'betweenness', label: 'Betweenness', value: (row) => row.betweenness, render: (row) => number(row.betweenness, 4) },
        { key: 'closeness', label: 'Closeness', value: (row) => row.closeness, render: (row) => number(row.closeness, 4) },
        { key: 'effector_target_degree', label: 'Effector targets', value: (row) => row.effector_target_degree, render: (row) => number(row.effector_target_degree) },
        {
            key: 'hub',
            label: 'Hub',
            value: (row, artifact) => (hubIds(artifact).has(row.id) ? 'yes' : 'no'),
            render: (row, artifact) => hubIds(artifact).has(row.id)
                ? '<span class="analysis-flag analysis-flag--ok">Hub</span>'
                : '<span class="analysis-flag analysis-flag--neutral">—</span>',
        },
        { key: 'component_id', label: 'Component', value: (row) => row.component_id, render: (row) => number(row.component_id) },
        { key: 'community_id', label: 'Community', value: (row) => row.community_id, render: (row) => number(row.community_id) },
    ],
    note: (artifact) => {
        const s = artifact.statistics;
        const base = `The STRING combined network at score ≥ 700 contains ${formatNumber(s.host_host_edge_count)} host-host edges across ${formatNumber(s.host_nodes_with_host_edges)} proteins. `
            + `Effector-host edges are curated PathoMap interactions and are reported separately from STRING edges. `;
        if (artifact.status === 'low_power') {
            return noticeHtml(
                base + 'Centrality and community structure are low-power; interpret rankings as descriptive, not stable biological hubs.',
                'warn'
            );
        }
        return noticeHtml(
            base + 'Centrality and community rankings remain descriptive and depend on STRING coverage.',
            'info'
        );
    },
    extra: (artifact) => `
        <div class="ia-panel">
            <div class="ia-panel-header"><h3>Top hubs and connected components</h3><span class="ia-panel-note">Descriptive</span></div>
            <div class="analysis-table-wrap">
                <table class="db-table analysis-table">
                    <thead><tr><th>Hub</th><th>Gene</th><th>Degree</th><th>Betweenness</th><th>Basis</th></tr></thead>
                    <tbody>
                        ${(artifact.hubs || []).slice(0, 12).map((hub) => `
                            <tr>
                                <td>${escapeHtml(hub.label)}</td>
                                <td>${escapeHtml(hub.gene_name || '—')}</td>
                                <td>${number(hub.degree)}</td>
                                <td>${number(hub.betweenness, 4)}</td>
                                <td>${escapeHtml((hub.bases || []).join(', '))}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <p class="analysis-table-footnote">
                    ${formatNumber(artifact.statistics.non_isolated_component_count)} non-isolated components; largest component ${formatNumber(artifact.statistics.largest_component_size)} proteins.
                </p>
            </div>
        </div>
    `,
});
