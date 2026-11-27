import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRecords } from '../js/experiment/csv.js';
import { calculateFeatures, cleanSequence, unknownResidues } from '../js/experiment/features.js';

test('parseRecords detects tabs and preserves quoted commas', () => {
  const parsed = parseRecords('name\tpathogen\tnote\nEffector A\tSalmonella\t"target, host"\n');
  assert.deepEqual(parsed.headers, ['name', 'pathogen', 'note']);
  assert.deepEqual(parsed.rows[0], {
    name: 'Effector A',
    pathogen: 'Salmonella',
    note: 'target, host',
  });
});

test('parseRecords normalizes duplicate headers', () => {
  const parsed = parseRecords('value,Value\n1,2\n');
  assert.deepEqual(parsed.headers, ['value', 'value_2']);
  assert.equal(parsed.rows[0].value_2, '2');
});

test('sequence features match the curated build formulas', () => {
  const sequence = 'MKTAILVFVKRLREGYDCPHQNA';
  assert.equal(cleanSequence(`>demo\nMKT AILV FVK\n`), 'MKTAILVFVK');
  assert.deepEqual(unknownResidues('MKX'), ['X']);
  assert.deepEqual(calculateFeatures(sequence), {
    sequence_length: 23,
    molecular_weight_da: 2690.2,
    isoelectric_point: 9.37,
    gravy_score: -0.291,
  });
});
