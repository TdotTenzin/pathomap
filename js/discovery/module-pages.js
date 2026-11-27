/*
  module-pages.js - Canonical page filename for each analysis module.

  Kept DOM-free so both the browser UI and Node tests can resolve module links.
*/

export const MODULE_PAGES = {
  'interaction-analysis': 'interaction-analysis.html',
  'sequence-analysis': 'sequence-analysis.html',
  'pathway-analysis': 'pathway-analysis.html',
  'functional-enrichment': 'functional-enrichment.html',
  'protein-network-analysis': 'protein-network-analysis.html',
  'comparative-pathogen-analysis': 'comparative-pathogen-analysis.html',
  'host-response-analysis': 'host-response-analysis.html',
  'predictive-readiness': 'predictive-readiness.html',
};

export function modulePageFor(moduleId) {
  return MODULE_PAGES[moduleId] || `${moduleId}.html`;
}
