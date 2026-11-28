import test from 'node:test';
import assert from 'node:assert/strict';

import { runDiscovery } from '../js/discovery/engine.js';
import { renderResultDetails } from '../js/ui/module-view.js';
import {
  buildReport,
  featureMatrixCsv,
  filterResult,
  unavailableMessage,
} from '../js/pages/sequence-analysis-view.js';

const dataset = {
  effectors: [
    {
      entity_id: 'E1',
      effector_name: 'Effector A',
      pathogen_name: 'Salmonella',
      phenotype: 'intracellular',
      sequence: 'MKTAILVFVKRLREGYDCPHQNA',
    },
    {
      entity_id: 'E2',
      effector_name: 'Effector B',
      pathogen_name: 'Escherichia coli',
      phenotype: 'extracellular',
      sequence: 'MKKLLLFFFVVVAAAKKRRRX',
    },
    {
      entity_id: 'E3',
      effector_name: 'Effector C',
      pathogen_name: 'Salmonella',
      phenotype: 'intracellular',
      sequence: '',
    },
  ],
};

const sequenceResult = () => runDiscovery(dataset).modules.find((module) => module.id === 'sequence-analysis');
const table = (result, title) => result.tables.find((item) => item.title === title);

test('sequence module publishes composition, stable IDs, and explicit missing reasons', () => {
  const result = sequenceResult();
  assert.equal(result.status, 'complete');

  const features = table(result, 'Per-effector features').rows;
  assert.equal(features.length, 2);
  assert.deepEqual(features.map((row) => row.entity_id), ['E1', 'E2']);
  assert.equal(features[1].unknown_residues, 'X');
  assert.match(result.warnings.join(' '), /non-standard residue\(s\) X excluded/);

  const composition = table(result, 'Amino acid composition').rows;
  assert.equal(composition.length, 20);
  const compositionCount = composition.reduce((sum, row) => sum + row.count, 0);
  const featureCount = features.reduce(
    (sum, row) => sum + Object.entries(row).filter(([key]) => key.startsWith('aa_')).reduce((inner, [, value]) => inner + value, 0),
    0
  );
  assert.equal(compositionCount, featureCount);
  assert.ok(Math.abs(composition.reduce((sum, row) => sum + row.fraction, 0) - 1) < 0.01);

  const missing = table(result, 'Missing sequences').rows;
  assert.deepEqual(missing, [{ effector: 'Effector C', pathogen: 'Salmonella', reason: 'Missing sequence' }]);
});

test('filters update every table, not just the per-effector table', () => {
  const result = sequenceResult();
  const filtered = filterResult(result, { phenotype: 'intracellular' });

  assert.deepEqual(table(filtered, 'Per-effector features').rows.map((row) => row.entity_id), ['E1']);
  assert.deepEqual(table(filtered, 'Distribution by phenotype').rows.map((row) => row.phenotype), ['intracellular']);
  assert.deepEqual(table(filtered, 'Missing sequences').rows, []);
  const composition = table(filtered, 'Amino acid composition').rows;
  assert.equal(composition.reduce((sum, row) => sum + row.count, 0), 23);
  assert.equal(table(result, 'Per-effector features').rows.length, 2, 'filters must not mutate the source result');
});

test('feature-matrix CSV and JSON export carry active filters and provenance', () => {
  const result = sequenceResult();
  const filters = { search: '', pathogen: 'Salmonella', phenotype: '' };
  const date = new Date('2026-01-02T03:04:05.000Z');

  const csv = featureMatrixCsv(result, filters, { origin: 'handoff', dataset }, date);
  assert.match(csv, /# source=pathomap-sequence-analysis/);
  assert.match(csv, /# generated_at=2026-01-02T03:04:05\.000Z/);
  assert.match(csv, /# origin=handoff/);
  assert.match(csv, /# filters=\{"search":"","pathogen":"Salmonella","phenotype":""\}/);
  assert.match(csv, /entity_id,effector,pathogen,phenotype,sequence_length/);
  assert.match(csv, /E1,Effector A,Salmonella,intracellular,23/);
  assert.doesNotMatch(csv, /E2,Effector B/);

  const report = buildReport(dataset, result, filters, 'handoff', date);
  assert.equal(report.meta.generated_at, date.toISOString());
  assert.equal(report.meta.origin, 'handoff');
  assert.equal(report.dataset.effectors_count, 3);
  assert.deepEqual(report.filters, filters);
  assert.equal(table(report.result, 'Per-effector features').rows.length, 1);
});

test('unavailable results show exact reasons and escaped detail markup', () => {
  const insufficient = runDiscovery({ effectors: [] }).modules.find((module) => module.id === 'sequence-analysis');
  assert.equal(unavailableMessage(insufficient), 'Insufficient data: Table "effectors" needs at least one row.');

  const failed = { status: 'failed', reasons: ['Bad <sequence>'] };
  assert.equal(unavailableMessage(failed), 'Analysis failed: Bad <sequence>');

  const markup = renderResultDetails({
    reasons: ['Bad <sequence>'],
    findings: ['Longest effector: <b>A</b>'],
    notes: [],
    warnings: [],
  });
  assert.match(markup, /data-result-details="reasons"/);
  assert.match(markup, /Bad &lt;sequence&gt;/);
  assert.match(markup, /Longest effector: &lt;b&gt;A&lt;\/b&gt;/);
  assert.doesNotMatch(markup, /<b>|<sequence>/);
  assert.doesNotMatch(markup, /data-result-details="notes"/);
});
