/*
  summary.js - Builds compact summaries from generated analysis artifacts.

  Purpose:
    Selects existing analytical outputs for display in the Generated Analyses
    cards. This module is pure: it never fetches, renders, or recalculates the
    underlying biology. Every scientific value comes from the generated
    interaction-analysis artifact, and the artifact is provenance-checked
    against the loaded dataset before any result is exposed.
*/

import { analysisMatchesDataset } from './network.js';
import { INTERACTION_EVIDENCE_CLASS_VALUES } from '../data/schema.js';
import { evidenceClassLabel } from '../utils/labels.js';

const EVIDENCE_CLASS_KEYS = new Set(INTERACTION_EVIDENCE_CLASS_VALUES);

const VALIDATION_ISSUE_FIELDS = [
    'interaction_issues',
    'evidence_issues',
    'result_issues',
];

function numberOrNull(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function unavailable(reason) {
    return {
        status: 'unavailable',
        reason,
        metrics: [],
        findings: [],
        evidence: null,
    };
}

function formatPercent(value) {
    const percent = value * 100;
    const rounded = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
    return `${rounded}%`;
}

function pathogenName(dataset, analysis, id) {
    const fromDataset = (dataset?.pathogens || []).find(
        (row) => row?.entity_id === id || String(row?.pathogen_id) === String(id)
    );

    if (fromDataset?.name) {
        return fromDataset.name;
    }

    const fromArtifact = (analysis?.network?.nodes || []).find(
        (node) => node?.type === 'pathogen' && node?.id === id
    );

    return fromArtifact?.label || null;
}

function buildMetrics(statistics) {
    return [
        {
            label: 'Candidate relationships',
            value: statistics.interaction_count,
        },
        {
            label: 'Pathogens',
            value: statistics.unique_pathogen_count,
        },
        {
            label: 'Effectors',
            value: statistics.unique_effector_count,
        },
        {
            label: 'Host proteins',
            value: statistics.unique_host_protein_count,
        },
        {
            label: 'Evidence records',
            value: statistics.evidence_count,
        },
    ];
}

function buildSharedHostFinding(analysis) {
    const rows = (analysis.host_proteins_targeted_by_multiple_pathogens || [])
        .filter((row) => numberOrNull(row?.pathogen_count) >= 2)
        .sort((a, b) =>
            b.pathogen_count - a.pathogen_count ||
            b.interaction_count - a.interaction_count ||
            String(a.gene_name || a.protein_name || '').localeCompare(
                String(b.gene_name || b.protein_name || '')
            )
        )
        .slice(0, 2);

    if (!rows.length) {
        return null;
    }

    const phrases = rows.map((row) => {
        const label = row.gene_name || row.protein_name || row.host_protein_id;
        return `${label} is a candidate target of ${row.pathogen_count} pathogens`;
    });

    return {
        label: 'Broadest host reuse',
        text: `${phrases.join('; ')}.`,
        note: 'Shared host targeting alone does not establish a common molecular mechanism.',
    };
}

function buildSharedBreadthFinding(statistics) {
    const shared = numberOrNull(statistics.host_proteins_targeted_by_multiple_pathogens_count);
    const hosts = numberOrNull(statistics.unique_host_protein_count);

    if (shared === null || hosts === null || shared === 0) {
        return null;
    }

    return {
        label: 'Shared targets',
        text: `${shared} of ${hosts} host proteins are candidate targets of at least two pathogens.`,
        note: null,
    };
}

function buildTopPathogenFinding(analysis, dataset, statistics) {
    const counts = Object.entries(statistics.interactions_by_pathogen || {})
        .map(([id, value]) => ({ id, count: numberOrNull(value) }))
        .filter((row) => row.count !== null && row.count > 0)
        .sort((a, b) =>
            b.count - a.count ||
            String(pathogenName(dataset, analysis, a.id) || a.id).localeCompare(
                String(pathogenName(dataset, analysis, b.id) || b.id)
            )
        );

    if (!counts.length) {
        return null;
    }

    const topCount = counts[0].count;
    const leaders = counts.filter((row) => row.count === topCount);
    const names = leaders
        .map((row) => pathogenName(dataset, analysis, row.id))
        .filter(Boolean);

    const countLabel = topCount === 1
        ? '1 candidate relationship'
        : `${topCount} candidate relationships`;

    const text = names.length === 1
        ? `${names[0]} has the most recorded candidate relationships (${countLabel}).`
        : names.length > 1 && names.length <= 3
            ? `${names.join(', ')} have the most recorded candidate relationships (${countLabel} each).`
            : `${leaders.length} pathogens share the highest recorded count (${countLabel} each).`;

    return {
        label: 'Most connected pathogens',
        text,
        note: null,
    };
}

function buildEvidence(analysis, statistics, validation) {
    const coverage = numberOrNull(statistics.evidence_coverage);
    const covered = numberOrNull(statistics.interactions_with_evidence_count);
    const interactions = numberOrNull(statistics.interaction_count);

    const classes = Object.entries(statistics.evidence_by_class || {})
        .map(([key, value]) => ({
            key,
            label: evidenceClassLabel(key, key),
            tone: EVIDENCE_CLASS_KEYS.has(key) ? key : 'other',
            count: numberOrNull(value),
        }))
        .filter((row) => row.count !== null && row.count > 0)
        .sort((a, b) => b.count - a.count);

    let coverageLabel = 'Not reported';
    if (coverage !== null) {
        coverageLabel = formatPercent(coverage);
    } else if (covered !== null && interactions !== null && interactions > 0) {
        coverageLabel = formatPercent(covered / interactions);
    }

    const issueCount = VALIDATION_ISSUE_FIELDS.reduce(
        (total, field) => total + (Array.isArray(validation?.[field]) ? validation[field].length : 0),
        0
    );

    return {
        coverageLabel,
        coveredCount: covered,
        interactionCount: interactions,
        classes,
        unresolvedTargetCount:
            numberOrNull(statistics.unresolved_target_count) ??
            numberOrNull(analysis.unresolved_targets?.target_count),
        validationPassed: validation ? issueCount === 0 : null,
        note: 'Coverage means a relationship has at least one supporting record; it is not experimental validation.',
    };
}

export function buildInteractionAnalysisSummary(analysis, dataset) {
    if (!dataset) {
        return unavailable('No dataset is loaded, so no dataset summary can be shown.');
    }

    if (!analysis) {
        return unavailable('No generated analysis is available for this dataset.');
    }

    if (!analysisMatchesDataset(analysis, dataset)) {
        return unavailable(
            'The generated analysis does not match this dataset; stale findings are hidden.'
        );
    }

    const statistics = analysis.statistics;
    const requiredFields = [
        'interaction_count',
        'unique_pathogen_count',
        'unique_effector_count',
        'unique_host_protein_count',
        'evidence_count',
    ];

    if (requiredFields.some((field) => numberOrNull(statistics?.[field]) === null)) {
        return unavailable('The generated analysis is incomplete, so findings cannot be shown.');
    }

    const findings = [
        buildSharedHostFinding(analysis),
        buildSharedBreadthFinding(statistics),
        buildTopPathogenFinding(analysis, dataset, statistics),
    ].filter(Boolean);

    return {
        status: 'ready',
        reason: null,
        metrics: buildMetrics(statistics),
        findings,
        evidence: buildEvidence(analysis, statistics, analysis.validation),
    };
}
