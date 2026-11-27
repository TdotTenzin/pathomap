import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REFERENCE_COLUMNS,
  REFERENCE_COLUMN_LABELS,
  REFERENCE_VISIBLE_COLUMNS,
  INTERACTION_EVIDENCE_COLUMNS,
  INTERACTION_EVIDENCE_COLUMN_LABELS,
  INTERACTION_EVIDENCE_VISIBLE_COLUMNS,
} from '../js/data/schema.js';

test('reference and evidence tabs expose every exported column with a label', () => {
  assert.deepEqual(REFERENCE_VISIBLE_COLUMNS, REFERENCE_COLUMNS);
  assert.deepEqual(INTERACTION_EVIDENCE_VISIBLE_COLUMNS, INTERACTION_EVIDENCE_COLUMNS);
  for (const key of REFERENCE_COLUMNS) {
    assert.ok(REFERENCE_COLUMN_LABELS[key], `missing label for ${key}`);
  }
  for (const key of INTERACTION_EVIDENCE_COLUMNS) {
    assert.ok(INTERACTION_EVIDENCE_COLUMN_LABELS[key], `missing label for ${key}`);
  }
});
