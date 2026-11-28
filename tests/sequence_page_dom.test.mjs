import test from 'node:test';
import assert from 'node:assert/strict';

import { queueDatasetForModule } from '../js/discovery/dataset-handoff.js';
import { unavailableMessage } from '../js/pages/sequence-analysis-view.js';

function makeElement(id = '') {
  return {
    id,
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    value: '',
    className: '',
    children: [],
    listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    get options() { return this.children; },
    focus() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute() { return null; },
  };
}

const ids = [
  'sa-search', 'sa-pathogen', 'sa-phenotype', 'sa-reset',
  'sa-stats-status', 'sa-table-source', 'sa-table-status', 'sa-table-empty',
  'sa-tables-content', 'sa-result-details', 'sa-download', 'sa-download-csv',
];
const elements = new Map(ids.map((id) => [id, makeElement(id)]));
const memory = new Map();

globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
};
globalThis.sessionStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
};
globalThis.document = {
  documentElement: makeElement('html'),
  getElementById: (id) => elements.get(id) ?? null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => makeElement(tag),
  body: makeElement('body'),
};

test('an insufficient dataset shows exact engine reasons on the sequence page', async () => {
  queueDatasetForModule({ effectors: [] });
  await import('../js/pages/sequence-analysis.js');

  const expected = unavailableMessage({
    status: 'insufficient data',
    reasons: ['Table "effectors" needs at least one row.'],
  });

  assert.equal(elements.get('sa-stats-status').textContent, expected);
  assert.doesNotMatch(elements.get('sa-stats-status').textContent, /No dataset on this page/);
  assert.match(elements.get('sa-table-status').textContent, /Table "effectors" needs at least one row\./);
  assert.match(elements.get('sa-result-details').innerHTML, /data-result-details="reasons"/);
  assert.match(elements.get('sa-result-details').innerHTML, /Table &quot;effectors&quot; needs at least one row\./);
  assert.equal(elements.get('sa-result-details').hidden, false);
  assert.equal(elements.get('sa-tables-content').innerHTML, '');
  assert.equal(elements.get('sa-table-empty').hidden, false);
  assert.equal(elements.get('sa-download').disabled, true);
  assert.equal(elements.get('sa-download-csv').disabled, true);
});
