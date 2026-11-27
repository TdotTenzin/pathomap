/*
  module-pages.js - Canonical page filename for each analysis module.

  Kept DOM-free so both the browser UI and Node tests can resolve module links.
*/

export const READINESS_MODULE_ID = 'predictive-readiness';
export const READINESS_ANCHOR = '#readiness';

export const MODULE_PAGES = {
  'interaction-analysis': 'interaction-analysis.html',
  'sequence-analysis': 'sequence-analysis.html',
  'pathway-analysis': 'pathway-analysis.html',
  'functional-enrichment': 'functional-enrichment.html',
  'protein-network-analysis': 'protein-network-analysis.html',
  'comparative-pathogen-analysis': 'comparative-pathogen-analysis.html',
  'host-response-analysis': 'host-response-analysis.html',
};

export const PAGED_MODULE_IDS = Object.keys(MODULE_PAGES);

// Readiness lives in the Discovery workspace, so its link is an in-page anchor.
export function modulePageFor(moduleId) {
  if (moduleId === READINESS_MODULE_ID) return READINESS_ANCHOR;
  return MODULE_PAGES[moduleId] || `${moduleId}.html`;
}
