import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ingestText } from '../js/discovery/ingest.js';
import { runDiscovery } from '../js/discovery/engine.js';
import { EXAMPLE, renderReadinessSection } from '../js/ui/module-view.js';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

function readinessResult(dataset) {
  return runDiscovery(dataset).modules.find((module) => module.id === 'predictive-readiness');
}

test('readiness section shows the full assessment inline after module summaries', () => {
  const ingest = ingestText(EXAMPLE);
  assert.equal(ingest.ok, true, ingest.errors.join(' '));
  const result = readinessResult(ingest.dataset);
  assert.equal(result.status, 'complete');

  const html = renderReadinessSection(result, { sourceLabel: 'Workspace dataset', effectorCount: 8 });
  assert.match(html, /<h3>Readiness<\/h3>/);
  assert.match(html, /Workspace dataset · Readiness assessment of 8 effector\(s\)/);
  assert.doesNotMatch(html, /predictive-readiness\.html/);
  for (const attr of [
    'data-readiness-search',
    'data-readiness-passed',
    'data-readiness-reset',
    'data-readiness-download',
    'data-readiness-empty',
    'data-readiness-row',
  ]) {
    assert.ok(html.includes(attr), `missing ${attr}`);
  }

  for (const metric of result.metrics) {
    assert.ok(
      html.includes(`<span class="exp-metric-value">${metric.value}</span>`)
        && html.includes(`<span class="exp-metric-label">${metric.label}</span>`),
      `missing metric ${metric.label}`
    );
  }
  for (const finding of result.findings) {
    assert.ok(html.includes(`<li>${finding}</li>`), `missing finding ${finding}`);
  }
  for (const row of result.tables[0].rows) {
    assert.ok(html.includes(`<td class="disc-readiness-cell">${row.check}</td>`), `missing check ${row.check}`);
    assert.ok(html.includes(`<td class="disc-readiness-cell">${row.value}</td>`), `missing value ${row.value}`);
    assert.ok(html.includes(`<td class="disc-readiness-cell">${row.requirement}</td>`), `missing minimum ${row.requirement}`);
    assert.ok(
      html.includes(`<td class="disc-readiness-cell disc-readiness-cell--${row.passed}">${row.passed}</td>`),
      `missing pass/fail state for ${row.check}`
    );
    assert.ok(html.includes(`data-passed="${row.passed}"`), `missing filter state for ${row.check}`);
  }
  for (const note of result.notes) {
    assert.ok(html.includes(`<li>${note}</li>`), `missing note ${note}`);
  }
  assert.ok(html.includes('disc-readiness-cell--yes') && html.includes('disc-readiness-cell--no'));

  const source = read('js/ui/discovery.js');
  const summariesIndex = source.indexOf("${report.modules.map(renderModuleSummary).join('')}");
  const readinessIndex = source.indexOf("${renderReadinessSection(readiness, { sourceLabel, effectorCount })}");
  assert.ok(summariesIndex > -1 && readinessIndex > summariesIndex, 'readiness must follow module summaries');
  assert.match(source, /renderReadinessSection\(null\)/);
  assert.match(source, /mountReadinessSection\(results\)/);
  assert.match(source, /data-readiness-download/);
});

test('readiness section handles waiting and insufficient data without inventing checks', () => {
  const waiting = renderReadinessSection(null);
  assert.match(waiting, /Waiting for data/);
  assert.match(waiting, /Load an example or dataset above/);
  assert.doesNotMatch(waiting, /Readiness checklist/);

  const insufficient = renderReadinessSection(readinessResult({ effectors: [] }));
  assert.match(insufficient, /Effector records are required to assess readiness\./);
  assert.doesNotMatch(insufficient, /Readiness checklist/);
});

test('readiness section escapes untrusted result text', () => {
  const html = renderReadinessSection({
    status: 'complete',
    metrics: [],
    findings: [],
    tables: [{
      title: 'Readiness checklist',
      columns: [{ key: 'check', label: 'Check' }],
      rows: [{ check: '<img src=x onerror=alert(1)>' }],
    }],
    notes: ['<script>alert(1)</script>'],
    warnings: [],
  });
  assert.doesNotMatch(html, /<img /);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
