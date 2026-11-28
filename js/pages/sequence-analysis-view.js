/*
  sequence-analysis-view.js - Pure filtering/export helpers for the sequence page.

  Kept DOM-free so filters, feature-matrix export and status messages can be
  tested without a browser.
*/

import { mean, round } from '../discovery/utils.js';
import { STANDARD_AMINO_ACIDS } from '../experiment/features.js';
import { toCsv } from '../utils/export.js';

export const FEATURE_TABLE_TITLE = 'Per-effector features';

const DISTRIBUTION_TITLE = 'Distribution by phenotype';
const COMPOSITION_TITLE = 'Amino acid composition';
const MISSING_TITLE = 'Missing sequences';

const RESIDUES = [...STANDARD_AMINO_ACIDS];

function matchesFilters(row, query, pathogen, phenotype) {
  const searchable = [row.effector, row.pathogen, row.phenotype, row.residue, row.reason]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (!query || searchable.includes(query))
    && (!pathogen || row.pathogen === pathogen)
    && (!phenotype || row.phenotype === phenotype);
}

function distributionRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.phenotype || 'Unlabelled';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([phenotype, group]) => ({
    phenotype,
    n: group.length,
    mean_length: round(mean(group.map((row) => row.sequence_length)), 1),
    mean_mw: round(mean(group.map((row) => row.molecular_weight_da)), 1),
    mean_pi: round(mean(group.map((row) => row.isoelectric_point)), 2),
    mean_gravy: round(mean(group.map((row) => row.gravy_score)), 3),
  }));
}

function compositionRows(rows) {
  const totals = Object.fromEntries(RESIDUES.map((aa) => [aa, 0]));
  for (const row of rows) {
    for (const aa of RESIDUES) totals[aa] += row[`aa_${aa}`] || 0;
  }
  const totalResidues = Object.values(totals).reduce((sum, count) => sum + count, 0);
  return RESIDUES.map((aa) => ({
    residue: aa,
    count: totals[aa],
    fraction: totalResidues ? round(totals[aa] / totalResidues, 4) : 0,
  }));
}

export function filterResult(result, filters = {}) {
  if (!result) return result;

  const query = String(filters.search || '').trim().toLowerCase();
  const pathogen = filters.pathogen || '';
  const phenotype = filters.phenotype || '';
  const matches = (row) => matchesFilters(row, query, pathogen, phenotype);

  const featureTable = (result.tables || []).find((table) => table.title === FEATURE_TABLE_TITLE);
  const featureRows = (featureTable?.rows || []).filter(matches);

  const tables = (result.tables || []).map((table) => {
    if (table.title === FEATURE_TABLE_TITLE) return { ...table, rows: featureRows };
    if (table.title === DISTRIBUTION_TITLE) return { ...table, rows: distributionRows(featureRows) };
    if (table.title === COMPOSITION_TITLE) return { ...table, rows: compositionRows(featureRows) };
    if (table.title === MISSING_TITLE) return { ...table, rows: (table.rows || []).filter(matches) };
    return table;
  });

  return { ...result, tables };
}

export function unavailableMessage(result) {
  const label = result?.status === 'failed' ? 'Analysis failed' : 'Insufficient data';
  const reasons = result?.reasons?.length ? result.reasons.join(' ') : 'No details provided.';
  return `${label}: ${reasons}`;
}

export function buildReport(dataset, result, filters = {}, origin = 'default', date = new Date()) {
  return {
    meta: {
      generated_at: date.toISOString(),
      source: 'pathomap-sequence-analysis',
      source_kind: 'dataset-handoff',
      origin,
    },
    dataset: {
      effectors_count: dataset?.effectors?.length || 0,
      origin,
    },
    filters: { ...filters },
    result: filterResult(result, filters),
  };
}

export function featureMatrixCsv(result, filters = {}, context = {}, date = new Date()) {
  const filtered = filterResult(result, filters);
  const table = (filtered?.tables || []).find((item) => item.title === FEATURE_TABLE_TITLE);
  const baseKeys = [
    'entity_id',
    'effector',
    'pathogen',
    'phenotype',
    'sequence_length',
    'molecular_weight_da',
    'isoelectric_point',
    'gravy_score',
    'unknown_residues',
  ];
  const columns = [
    ...baseKeys.map((key) => ({ key, label: key })),
    ...RESIDUES.map((aa) => ({ key: `aa_${aa}`, label: `aa_${aa}` })),
  ];
  const meta = [
    '# source=pathomap-sequence-analysis',
    `# generated_at=${date.toISOString()}`,
    `# status=${filtered?.status || 'unknown'}`,
    `# origin=${context.origin || 'default'}`,
    `# effectors=${context.effectors ?? datasetEffectorCount(context)}`,
    `# filters=${JSON.stringify(filters)}`,
  ];
  return `${meta.join('\n')}\n${toCsv(columns, table?.rows || [])}`;
}

function datasetEffectorCount(context) {
  return context.dataset?.effectors?.length || 0;
}
