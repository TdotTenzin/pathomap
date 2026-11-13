import { initArtifactPage, number } from './artifact-page.js';
import { escapeHtml, formatNumber, noticeHtml } from '../analysis/artifact.js';

function pathogenName(artifact, id) {
    return artifact.by_pathogen?.find((item) => item.pathogen_id === id)?.pathogen_name || `Pathogen ${id}`;
}

function motifText(row) {
    return (row.motifs || []).map((motif) => motif.name).join(', ');
}

initArtifactPage({
    title: 'Effector Sequence Analysis',
    artifact: 'effectorSequences',
    command: 'python scripts/analyze_effector_sequences.py',
    csvName: 'effector-sequence-analysis',
    searchPlaceholder: 'Search effector, pathogen, type, or motif…',
    filter: {
        allLabel: 'All effector types',
        options: (artifact) => (artifact.by_type_class || []).map((item) => ({
            value: item.type_class,
            label: item.type_class,
        })),
        predicate: (row, value) => row.type_class === value,
    },
    stats: (artifact) => {
        const s = artifact.statistics;
        return [
            { label: 'Effectors', value: number(s.effector_count) },
            { label: 'Sequenced', value: number(s.sequenced_count) },
            { label: 'Missing sequence', value: number(s.missing_sequence_count) },
            { label: 'Domain families', value: number(s.domain_family_count) },
        ];
    },
    rows: (artifact) => artifact.features || [],
    search: (row, artifact) => [
        row.effector_name,
        pathogenName(artifact, row.pathogen_id),
        row.type_class,
        motifText(row),
        row.entity_id,
    ].join(' '),
    defaultSort: 'sequence_length',
    columns: [
        {
            key: 'effector_name',
            label: 'Effector',
            render: (row) => `<strong>${escapeHtml(row.effector_name)}</strong><br><span class="analysis-muted">${escapeHtml(row.entity_id)}</span>`,
        },
        {
            key: 'pathogen_id',
            label: 'Pathogen',
            value: (row, artifact) => pathogenName(artifact, row.pathogen_id),
            render: (row, artifact) => escapeHtml(pathogenName(artifact, row.pathogen_id)),
        },
        {
            key: 'type_class',
            label: 'Type',
            render: (row) => `<span class="analysis-tag">${escapeHtml(row.type_class)}</span>`,
        },
        { key: 'sequence_length', label: 'Length', value: (row) => row.sequence_length, render: (row) => number(row.sequence_length) },
        { key: 'molecular_weight_da', label: 'MW (Da)', value: (row) => row.molecular_weight_da, render: (row) => number(row.molecular_weight_da, 0) },
        { key: 'isoelectric_point', label: 'pI', value: (row) => row.isoelectric_point, render: (row) => number(row.isoelectric_point, 2) },
        { key: 'gravy_score', label: 'GRAVY', value: (row) => row.gravy_score, render: (row) => number(row.gravy_score, 3) },
        { key: 'shannon_entropy_bits', label: 'Entropy', value: (row) => row.shannon_entropy_bits, render: (row) => number(row.shannon_entropy_bits, 2) },
        { key: 'domain_count', label: 'Domains', value: (row) => row.domain_count, render: (row) => number(row.domain_count) },
        { key: 'domain_coverage', label: 'Coverage', value: (row) => row.domain_coverage, render: (row) => `${number(row.domain_coverage * 100, 1)}%` },
        { key: 'motifs', label: 'Motifs', value: (row) => motifText(row), render: (row) => escapeHtml(motifText(row) || '—') },
        {
            key: 'flags',
            label: 'Flags',
            value: (row) => [
                row.signal_peptide_annotated ? 'signal peptide' : '',
                row.transmembrane_region_count ? `${row.transmembrane_region_count} TM` : '',
            ].filter(Boolean).join('; '),
            render: (row) => escapeHtml([
                row.signal_peptide_annotated ? 'signal peptide' : '',
                row.transmembrane_region_count ? `${row.transmembrane_region_count} TM` : '',
            ].filter(Boolean).join('; ') || '—'),
        },
    ],
    note: (artifact) => noticeHtml(
        `${formatNumber(artifact.statistics.missing_sequence_count)} effectors have no curated sequence and are excluded from computed features. `
        + `Domain coverage and motif hits are annotation-derived, not experimental evidence of function or conservation.`,
        'info'
    ),
    extra: (artifact) => {
        const top = [...(artifact.domain_families || [])].slice(0, 10);
        return `
            <div class="ia-panel">
                <div class="ia-panel-header"><h3>Most frequent domain families</h3><span class="ia-panel-note">Top 10</span></div>
                <div class="analysis-table-wrap">
                    <table class="db-table analysis-table">
                        <thead><tr><th>Family</th><th>Effectors</th><th>Pathogens</th></tr></thead>
                        <tbody>
                            ${top.map((family) => `
                                <tr>
                                    <td>${escapeHtml(family.family_name)}${family.accession ? `<br><span class="analysis-muted">${escapeHtml(family.accession)}</span>` : ''}</td>
                                    <td>${number(family.effector_count)}</td>
                                    <td>${number(family.pathogen_count)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },
});
