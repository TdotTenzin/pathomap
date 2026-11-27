import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { DISCOVERY_MODULES } from '../js/discovery/engine.js';
import { modulePageFor, PAGED_MODULE_IDS, READINESS_MODULE_ID } from '../js/discovery/module-pages.js';
import { consumeQueuedDataset, queueDatasetForModule } from '../js/discovery/dataset-handoff.js';
import { renderModule, renderModuleSummary, renderWaitingSummary } from '../js/ui/module-view.js';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

function pageFor(moduleId) {
  return `pages/${modulePageFor(moduleId)}`;
}

test('every paged analysis module has a dedicated page', () => {
  for (const moduleId of PAGED_MODULE_IDS) {
    const html = read(pageFor(moduleId));
    assert.match(html, /<!DOCTYPE html>/, `${moduleId} page is not HTML`);
    assert.match(
      html,
      new RegExp(`<body data-module="${moduleId}">`),
      `${moduleId} page does not select its module`
    );
    assert.match(html, /href="transparency\.html">Limitations &amp; Scope</);
    assert.doesNotMatch(html, /<a[^>]+>Transparency<\/a>/);
  }
});

test('paged modules load their own controller scripts', () => {
  for (const moduleId of PAGED_MODULE_IDS) {
    const html = read(pageFor(moduleId));
    const controller = `js/pages/${moduleId}.js`;
    assert.match(
      html,
      new RegExp(`src="\\.\\.\\/${controller.replace(/\./g, '\\.')}"`),
      `${moduleId} page does not load ${controller}`
    );
    assert.match(html, /id="dark-toggle"/);
  }
});

test('module pages do not duplicate the workspace upload panel', () => {
  const source = read('js/pages/module-page.js');
  assert.doesNotMatch(source, /exp-panel/);
  assert.doesNotMatch(source, /mod-input/);
  assert.doesNotMatch(source, /mod-run/);
  assert.match(source, /consumeQueuedDataset\(\)/);
  assert.match(source, /renderWaitingModule\(moduleMeta, \{ message: WAITING_MESSAGE \}\)/);
});

test('the workspace nav links to every module page', () => {
  const index = read('pages/index.html');
  for (const moduleId of PAGED_MODULE_IDS) {
    const href = `/${pageFor(moduleId)}`;
    assert.ok(index.includes(`href="${href}"`), `workspace nav is missing ${href}`);
  }
});

test('module pages share the same complete module nav', () => {
  for (const moduleId of PAGED_MODULE_IDS) {
    const html = read(pageFor(moduleId));
    for (const target of PAGED_MODULE_IDS) {
      assert.ok(
        html.includes(`href="${pageFor(target).replace('pages/', '')}"`),
        `${moduleId} page nav is missing ${target}`
      );
    }
    assert.match(html, /href="transparency\.html"/);
    assert.doesNotMatch(html, />Transparency<\/a>/);
  }
});

test('Vercel rewrites expose every module page at the root', () => {
  const config = JSON.parse(read('vercel.json'));
  const destinations = config.rewrites.map((rewrite) => rewrite.destination);
  for (const moduleId of PAGED_MODULE_IDS) {
    const destination = `/${pageFor(moduleId)}`;
    assert.ok(destinations.includes(destination), `rewrite is missing ${destination}`);
  }
});

test('readiness is inline in the workspace with no page, controller, nav item, or rewrite', () => {
  const module = DISCOVERY_MODULES.find((item) => item.id === READINESS_MODULE_ID);
  assert.ok(module, 'readiness module must still run in the workspace');
  assert.equal(modulePageFor(READINESS_MODULE_ID), '#readiness');
  assert.equal(PAGED_MODULE_IDS.includes(READINESS_MODULE_ID), false);
  for (const file of ['pages/predictive-readiness.html', 'js/pages/predictive-readiness.js']) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false, `${file} still exists`);
  }

  const pages = ['pages/index.html', 'pages/transparency.html', ...PAGED_MODULE_IDS.map((id) => pageFor(id))];
  for (const file of pages) {
    assert.doesNotMatch(
      read(file),
      /href="(?:\/pages\/)?predictive-readiness\.html"/,
      `${file} still links to the deleted readiness page`
    );
  }
  const config = JSON.parse(read('vercel.json'));
  assert.equal(config.rewrites.some((rewrite) => rewrite.destination.includes(READINESS_MODULE_ID)), false);
});

test('workspace summary cards link to the module page without embedding details', () => {
  const module = DISCOVERY_MODULES.find((item) => item.id === 'sequence-analysis');
  const html = renderModuleSummary({
    ...module,
    status: 'complete',
    reasons: [],
    metrics: [{ value: '8', label: 'sequences analyzed' }],
    findings: ['All sequences passed validation.'],
    notes: [],
    warnings: [],
  });

  assert.match(html, /class="disc-summary"/);
  assert.match(html, /Show full results/);
  assert.match(html, new RegExp(`href="${modulePageFor(module.id)}"`));
  assert.match(html, /8<\/strong> sequences analyzed/);
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /data-network-for/);
});

test('waiting summaries show a module link before any data is loaded', () => {
  const module = DISCOVERY_MODULES.find((item) => item.id === 'predictive-readiness');
  const html = renderWaitingSummary(module);
  assert.match(html, /Waiting for data/);
  assert.match(html, /No dataset loaded yet/);
  assert.match(html, /href="#readiness"/);
});

test('pathway module renders a toggle between broad and detailed views', () => {
  const module = DISCOVERY_MODULES.find((item) => item.id === 'pathway-analysis');
  const html = renderModule({
    ...module,
    status: 'complete',
    reasons: [],
    metrics: [{ label: 'Host proteins', value: '33' }],
    findings: ['Endocytic pathway: 5 protein(s)'],
    tables: [],
    views: [
      { id: 'broad', label: 'Broad categories', viewLabel: 'Pathway detail level', metrics: [], findings: [], tables: [] },
      { id: 'detailed', label: 'Detailed annotations', viewLabel: 'Pathway detail level', metrics: [], findings: [], tables: [] },
    ],
    notes: [],
    warnings: [],
  }, { open: true });

  assert.match(html, /data-view-switch="pathway-analysis"/);
  assert.match(html, /data-view-tab="broad"/);
  assert.match(html, /data-view-tab="detailed"/);
  assert.match(html, /data-view-panel="broad"/);
  assert.match(html, /data-view-panel="detailed" hidden/);
});

test('module-page handoff is one-shot and uses session storage only', () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };

  const dataset = { meta: { source: 'curated' }, pathogens: [{ name: 'Salmonella' }] };
  queueDatasetForModule(dataset);
  assert.deepEqual(consumeQueuedDataset(), dataset);
  assert.equal(consumeQueuedDataset(), null);
  assert.equal(store.size, 0);
  delete globalThis.sessionStorage;
});

test('interaction page has no automatic curated dataset fallback', () => {
  const source = read('js/pages/interaction-analysis.js');
  assert.doesNotMatch(source, /DEFAULT_DATASET_URL/);
  assert.doesNotMatch(source, /loadDataset\(/);
  assert.match(source, /consumeQueuedDataset\(\)/);
  assert.match(source, /queueDatasetForModule\(state\.dataset\)/);
  assert.match(source, /showNoDataset\('No dataset on this page/);
});
