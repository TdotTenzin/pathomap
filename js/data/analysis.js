/*
  analysis.js - Loader for generated analysis artifacts.

  Every Phase 4+ engine writes one JSON file under data/derived. Pages fetch
  the artifact by name and show an actionable error with the generator command
  when the file has not been built yet.
*/

export const ANALYSIS_ARTIFACTS = {
    interaction: 'data/derived/interaction_analysis.json',
    effectorSequences: 'data/derived/effector_sequence_analysis.json',
    functionalEnrichment: 'data/derived/functional_enrichment.json',
    pathways: 'data/derived/pathway_analysis.json',
    proteinNetwork: 'data/derived/protein_network.json',
    comparativePathogens: 'data/derived/comparative_pathogen.json',
};

export const DEFAULT_INTERACTION_ANALYSIS_URL = ANALYSIS_ARTIFACTS.interaction;

export async function loadAnalysisArtifact(nameOrUrl) {
    const url = ANALYSIS_ARTIFACTS[nameOrUrl] || nameOrUrl;
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
        const error = new Error(`Could not load ${url} (HTTP ${response.status}).`);
        error.url = url;
        error.status = response.status;
        throw error;
    }

    return response.json();
}

export async function loadInteractionAnalysis(url = DEFAULT_INTERACTION_ANALYSIS_URL) {
    return loadAnalysisArtifact(url);
}
