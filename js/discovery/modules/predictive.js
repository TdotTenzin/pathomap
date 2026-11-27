/* Module 08 - Predictive Modelling readiness assessment only (no model is trained). */

import { eligible, percent } from '../utils.js';

const MIN_LABELLED = 20;
const MIN_PATHOGENS = 5;
const MIN_FEATURE_COMPLETENESS = 0.9;

export default {
  id: 'predictive-readiness',
  number: '08',
  name: 'Prediction Readiness',
  question: 'Is the upload suitable for a future predictive module?',
  description: 'A data-readiness checklist. No predictions or performance metrics are produced.',

  canRun(dataset) {
    return eligible((dataset?.effectors?.length || 0) > 0, ['Effector records are required to assess readiness.']);
  },

  run(dataset) {
    const effectors = dataset.effectors || [];
    const labelled = effectors.filter((effector) => effector.phenotype);
    const labels = new Set(labelled.map((effector) => effector.phenotype));
    const pathogens = new Set(effectors.map((effector) => effector.pathogen_name || effector.pathogen_id).filter(Boolean));
    const complete = effectors.filter((effector) =>
      Number.isFinite(effector.sequence_length)
      && Number.isFinite(effector.molecular_weight_da)
      && Number.isFinite(effector.isoelectric_point)
      && Number.isFinite(effector.gravy_score)
    );
    const completeness = effectors.length === 0 ? 0 : complete.length / effectors.length;

    const checks = [
      {
        check: 'Labelled examples',
        value: String(labelled.length),
        requirement: `≥ ${MIN_LABELLED}`,
        passed: labelled.length >= MIN_LABELLED,
      },
      {
        check: 'Distinct phenotype labels',
        value: String(labels.size),
        requirement: '≥ 2',
        passed: labels.size >= 2,
      },
      {
        check: 'Independent pathogen groups',
        value: String(pathogens.size),
        requirement: `≥ ${MIN_PATHOGENS}`,
        passed: pathogens.size >= MIN_PATHOGENS,
      },
      {
        check: 'Complete feature vectors',
        value: percent(completeness),
        requirement: `≥ ${percent(MIN_FEATURE_COMPLETENESS, 0)}`,
        passed: completeness >= MIN_FEATURE_COMPLETENESS,
      },
    ];

    const failed = checks.filter((check) => !check.passed);
    const ready = failed.length === 0;

    return {
      metrics: [
        { label: 'Readiness', value: ready ? 'Adequate for planning' : 'Not ready' },
        { label: 'Labelled effectors', value: String(labelled.length) },
        { label: 'Feature completeness', value: percent(completeness) },
        { label: 'Checks passed', value: `${checks.length - failed.length}/${checks.length}` },
      ],
      findings: failed.map((check) => `${check.check}: ${check.value} (needs ${check.requirement})`),
      tables: [
        {
          title: 'Readiness checklist',
          columns: [
            { key: 'check', label: 'Check' },
            { key: 'value', label: 'Value' },
            { key: 'requirement', label: 'Minimum' },
            { key: 'passed', label: 'Passed' },
          ],
          rows: checks.map((check) => ({ ...check, passed: check.passed ? 'yes' : 'no' })),
        },
      ],
      notes: [
        'This module deliberately produces no model, score, or accuracy.',
        'Adequate data for planning is not permission to claim meaningful prediction; independent validation and leakage-aware splits are still required.',
        'With inadequate data, the correct output is this readiness assessment.',
      ],
      warnings: [],
    };
  },

  validate(result) {
    const rows = result.tables?.[0]?.rows || [];
    return {
      valid: rows.length === 4 && rows.every((row) => ['yes', 'no'].includes(row.passed)),
      issues: [],
    };
  },
};
