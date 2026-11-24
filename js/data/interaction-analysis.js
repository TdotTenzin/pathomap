/*
  interaction-analysis.js - Loader for generated analysis artifacts.

  Purpose:
    Fetches the Phase 4 interaction-analysis outputs. Both built-in datasets
    have a matching artifact. The network page treats these files as optional:
    the caller falls back to dataset interaction tables when an artifact is
    missing or does not match the loaded dataset.
*/

import { analysisMatchesDataset } from '../analysis/network.js';

export const DEFAULT_INTERACTION_ANALYSIS_URL = '/data/derived/interaction_analysis.json';
export const SAMPLE_INTERACTION_ANALYSIS_URL = '/data/derived/interaction_analysis_sample.json';

export const INTERACTION_ANALYSIS_URLS = [
    DEFAULT_INTERACTION_ANALYSIS_URL,
    SAMPLE_INTERACTION_ANALYSIS_URL,
];

export async function loadInteractionAnalysis(
    url = DEFAULT_INTERACTION_ANALYSIS_URL
) {
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
        throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
    }

    return response.json();
}

// Return the generated artifact whose provenance matches the loaded dataset.
export async function loadMatchingInteractionAnalysis(dataset) {
    const errors = [];

    for (const url of INTERACTION_ANALYSIS_URLS) {
        try {
            const analysis = await loadInteractionAnalysis(url);
            if (analysisMatchesDataset(analysis, dataset)) {
                return { analysis, errors };
            }
        } catch (error) {
            errors.push(error);
        }
    }

    return { analysis: null, errors };
}
