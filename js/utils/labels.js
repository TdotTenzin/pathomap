/*
  labels.js - Shared display labels for curated enumerations.

  Kept dependency-free so small UI modules do not need to import the full
  network model just to format a badge.
*/

export const EVIDENCE_CLASS_LABELS = {
    experimental: 'Experimental',
    predicted: 'Predicted',
    'annotation-derived': 'Annotation-derived',
    hypothetical: 'Hypothetical',
};

export const EVIDENCE_RANK = {
    experimental: 4,
    predicted: 3,
    'annotation-derived': 2,
    hypothetical: 1,
};

export const STRATEGY_LABELS = {
    arrest: 'Arrest',
    escape: 'Escape',
    reroute: 'Reroute',
    modified_compartment: 'Modified compartment',
    extracellular: 'Extracellular',
    unknown: 'Unknown',
};

export function evidenceRank(value) {
    return EVIDENCE_RANK[value] || 0;
}

export function evidenceClassLabel(value, fallback = 'No evidence') {
    return EVIDENCE_CLASS_LABELS[value] || value || fallback;
}
