/*
  engine.js - Orchestrates every module specified in docs/ANALYSES.md.

  Modules return structured data only. The UI decides how to render it. Missing
  prerequisites produce "insufficient data" with exact reasons, never fabricated
  results.
*/

import { DISCOVERY_MODULES } from './modules/index.js';

function baseResult(module) {
  return {
    id: module.id,
    number: module.number,
    name: module.name,
    question: module.question,
    description: module.description,
    status: 'insufficient data',
    reasons: [],
    metrics: [],
    findings: [],
    tables: [],
    notes: [],
    warnings: [],
  };
}

export function runDiscovery(dataset) {
  const results = DISCOVERY_MODULES.map((module) => {
    const result = baseResult(module);
    const eligibility = module.canRun(dataset);

    if (!eligibility.eligible) {
      result.reasons = eligibility.reasons;
      return result;
    }

    try {
      const output = module.run(dataset) || {};
      const validation = module.validate ? module.validate(output) : { valid: true, issues: [] };
      const issues = validation.issues || [];

      return {
        ...result,
        ...output,
        status: validation.valid ? 'complete' : 'failed',
        reasons: issues,
        warnings: [...(output.warnings || []), ...issues],
      };
    } catch (error) {
      console.error(`Discovery module ${module.id} failed:`, error);
      return {
        ...result,
        status: 'failed',
        reasons: [`Module error: ${error.message}`],
        warnings: [`Module error: ${error.message}`],
      };
    }
  });

  return {
    modules: results,
    summary: {
      total: results.length,
      complete: results.filter((result) => result.status === 'complete').length,
      insufficient: results.filter((result) => result.status === 'insufficient data').length,
      failed: results.filter((result) => result.status === 'failed').length,
    },
  };
}

export { DISCOVERY_MODULES };
