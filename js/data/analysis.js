/*
  analysis.js - Loader for generated analysis artifacts.

  Purpose:
    Fetches the Phase 4 interaction-analysis output. The network page treats
    this file as optional: the caller falls back to dataset interaction tables
    when the artifact is missing or does not match the loaded dataset.
*/

export const DEFAULT_INTERACTION_ANALYSIS_URL = 'data/derived/interaction_analysis.json';

export async function loadInteractionAnalysis(
    url = DEFAULT_INTERACTION_ANALYSIS_URL
) {
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
        throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
    }

    return response.json();
}
