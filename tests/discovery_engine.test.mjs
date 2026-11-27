import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ingestText } from '../js/discovery/ingest.js';
import { runDiscovery } from '../js/discovery/engine.js';
import { normalizeDataset } from '../js/utils/dataset.js';
import { EXAMPLE } from '../js/ui/module-view.js';

const SAMPLE = `pathogen,effector,sequence,host_protein,uniprot,pathway,phenotype,assay,value,evidence_class,doi,mechanism
Salmonella,SteE,MKTAILVFVKRLREGYDCPHQNA,ACTB,P60709,Actin cytoskeleton,intracellular,score,0.82,experimental,10.1126/a,Actin remodeling
Salmonella,GtgE,MKKLLLIVFFVAAALLLLGG,TUBB,P07437,Microtubule,intracellular,score,0.91,experimental,10.1126/b,Vesicle trafficking
Escherichia coli,EspF,MKDEEQQQQNNSSTTGGGCC,ACTB,P60709,Actin cytoskeleton,extracellular,score,0.31,predicted,,Adhesion
Escherichia coli,ExoS,MKLLLFFFVVVAAAKKRRR,TUBB,P07437,Microtubule,intracellular,score,0.78,annotation-derived,,Cytoskeleton modulation`;

function analyze(text = SAMPLE) {
  const ingest = ingestText(text);
  assert.equal(ingest.ok, true, ingest.errors.join(' '));
  return { ingest, report: runDiscovery(ingest.dataset) };
}

function moduleById(report, id) {
  return report.modules.find((module) => module.id === id);
}

test('ingest detects plain-language columns and builds linked tables', () => {
  const { ingest } = analyze();
  assert.equal(ingest.mapping.pathogen, 'pathogen');
  assert.equal(ingest.mapping.host, 'host_protein');
  assert.equal(ingest.mapping.value, 'value');
  assert.equal(ingest.rowCount, 4);
  assert.equal(ingest.dataset.pathogens.length, 2);
  assert.equal(ingest.dataset.effectors.length, 4);
  assert.equal(ingest.dataset.host_proteins.length, 2);
  assert.equal(ingest.dataset.interactions.length, 4);
  assert.equal(ingest.dataset.interaction_evidence.length, 4);
  assert.equal(ingest.dataset.references.length, 2);
  assert.equal(ingest.dataset.effectors[0].molecular_weight_da, 2690.2);
});

test('column mapping overrides replace auto-detected fields', () => {
  const text = 'organism,protein,seq,target,group,signal\nSalmonella,SteE,MKTAILVFVKRLREGYDCPHQNA,ACTB,intracellular,0.8\n';
  const ingest = ingestText(text, {
    pathogen: 'organism',
    effector: 'protein',
    sequence: 'seq',
    host: 'target',
    phenotype: 'group',
    value: 'signal',
  });
  assert.equal(ingest.dataset.effectors.length, 1);
  assert.equal(ingest.dataset.effectors[0].sequence_length, 23);
  assert.equal(ingest.dataset.measurements[0].value, 0.8);
});

test('every documented module returns a structured result', () => {
  const { report } = analyze();
  assert.equal(report.summary.total, 8);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.complete, 8);
  for (const module of report.modules) {
    assert.ok(['complete', 'insufficient data', 'failed'].includes(module.status));
    assert.ok(Array.isArray(module.metrics));
    assert.ok(Array.isArray(module.findings));
    assert.ok(Array.isArray(module.tables));
    assert.ok(Array.isArray(module.notes));
  }
});

test('the workspace example activates every module', () => {
  const ingest = ingestText(EXAMPLE);
  assert.equal(ingest.ok, true);
  const report = runDiscovery(ingest.dataset);
  assert.equal(report.summary.total, 8);
  assert.equal(report.summary.complete, 8);
  assert.equal(report.summary.insufficient, 0);
});

test('interaction analysis maps the uploaded network and evidence', () => {
  const { report } = analyze();
  const result = moduleById(report, 'interaction-analysis');
  assert.equal(result.status, 'complete');
  assert.equal(result.metrics.find((metric) => metric.label === 'Interactions').value, '4');
  assert.equal(result.metrics.find((metric) => metric.label === 'Annotated target links').value, '4');
  assert.equal(result.metrics.find((metric) => metric.label === 'Evidence coverage').value, '100.0%');
  const shared = result.tables.find((table) => table.title === 'Shared host proteins');
  assert.equal(shared.rows.length, 2);
  assert.equal(shared.rows[0].pathogen_count, 2);
  assert.equal(result.network.filtered.interactionEdges.length, 8);
  assert.equal(result.network.filtered.interactionEdges.filter((edge) => edge.kind === 'target_association').length, 4);
});

test('sequence analysis reports descriptors and missing sequences without prediction', () => {
  const { report } = analyze();
  const result = moduleById(report, 'sequence-analysis');
  assert.equal(result.status, 'complete');
  assert.equal(result.metrics.find((metric) => metric.label === 'Sequences analyzed').value, '4');
  assert.equal(result.tables[0].rows[0].molecular_weight_da, 2690.2);
  assert.equal(result.tables[0].rows[0].isoelectric_point, 9.37);
  assert.equal(result.tables.find((table) => table.title === 'Distribution by phenotype').rows.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /LOO|accuracy|classifier/i);
});

test('pathway analysis lists represented pathways and unmapped proteins', () => {
  const { report } = analyze();
  const result = moduleById(report, 'pathway-analysis');
  assert.equal(result.status, 'complete');
  assert.equal(result.tables[0].rows.length, 2);
  assert.equal(result.metrics.find((metric) => metric.label === 'Unmapped proteins').value, '0');
});

test('enrichment uses uploaded host IDs for the query set', () => {
  const { report } = analyze();
  const result = moduleById(report, 'functional-enrichment');
  assert.equal(result.status, 'complete');
  assert.equal(result.metrics.find((metric) => metric.label === 'Query proteins').value, '2');
  assert.equal(result.tables[0].rows.length, 2);
  assert.ok(result.tables[0].rows.every((row) => row.k === 1));
  assert.ok(result.tables[0].rows.every((row) => row.q_value !== null));
});

test('protein network analysis computes degree, centrality, and components', () => {
  const { report } = analyze();
  const result = moduleById(report, 'protein-network-analysis');
  assert.equal(result.status, 'complete');
  const nodes = result.tables[0].rows;
  assert.equal(nodes.length, 8);
  assert.ok(nodes.every((row) => Number.isFinite(row.betweenness) && Number.isFinite(row.closeness)));
  assert.equal(result.metrics.find((metric) => metric.label === 'Components').value, '1');
});

test('comparative analysis produces a similarity matrix and clusters', () => {
  const { report } = analyze();
  const result = moduleById(report, 'comparative-pathogen-analysis');
  assert.equal(result.status, 'complete');
  const matrix = result.tables[0];
  assert.equal(matrix.rows.length, 2);
  assert.deepEqual(Object.values(matrix.rows[0]).filter(Number.isFinite), [1, 0]);
  assert.equal(result.tables[1].rows[0].effectors, 2);
});

test('host response analysis links target annotations to pathogens and evidence', () => {
  const { report } = analyze();
  const result = moduleById(report, 'host-response-analysis');
  assert.equal(result.status, 'complete');
  const processes = result.tables[0].rows;
  assert.equal(processes.length, 2);
  assert.ok(processes.every((row) => row.proteins === 1 && row.pathogens === 2));
  assert.ok(processes.every((row) => row.pathogen_names.includes('Salmonella')));
  assert.ok(processes.every((row) => row.evidence_classes.includes('experimental')));
});

test('prediction readiness reports data checks and never trains a model', () => {
  const { report } = analyze();
  const result = moduleById(report, 'predictive-readiness');
  assert.equal(result.status, 'complete');
  assert.equal(result.metrics.find((metric) => metric.label === 'Readiness').value, 'Not ready');
  assert.equal(result.tables[0].rows.length, 4);
  assert.ok(!result.metrics.some((metric) => /accuracy|AUC/i.test(metric.label)));
  assert.ok(!result.findings.some((finding) => /accuracy|AUC/i.test(finding)));
});

test('missing prerequisites produce insufficient data with exact reasons', () => {
  const { report } = analyze('pathogen,effector_name\nSalmonella,SteE\n');
  assert.equal(report.summary.complete, 1);
  assert.equal(report.summary.insufficient, 7);
  const interaction = moduleById(report, 'interaction-analysis');
  assert.equal(interaction.status, 'insufficient data');
  assert.ok(interaction.reasons.some((reason) => reason.includes('interactions')));
  const sequence = moduleById(report, 'sequence-analysis');
  assert.ok(sequence.reasons.some((reason) => reason.includes('sequence')));
});

test('empty or invalid input is rejected before analysis', () => {
  assert.equal(ingestText('').ok, false);
  assert.equal(ingestText('{"broken":').ok, false);
  assert.equal(ingestText('a,b\n').ok, false);
});

test('a curated dataset drives the same modules and network', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/sample-dataset.json', import.meta.url), 'utf8'));
  const dataset = normalizeDataset(raw);
  const report = runDiscovery(dataset);

  assert.equal(report.summary.total, 8);
  assert.equal(moduleById(report, 'interaction-analysis').status, 'complete');
  assert.equal(moduleById(report, 'comparative-pathogen-analysis').status, 'complete');
  assert.ok(report.summary.complete >= 4, `only ${report.summary.complete} modules completed`);
});

test('curated dataset readiness passes with propagated labels and derived features', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/pathomap-dataset.json', import.meta.url), 'utf8'));
  const report = runDiscovery(normalizeDataset(raw));
  const result = moduleById(report, 'predictive-readiness');
  const rows = Object.fromEntries(result.tables[0].rows.map((row) => [row.check, row]));

  assert.equal(rows['Labelled examples'].value, '246');
  assert.equal(rows['Distinct phenotype labels'].value, '5');
  assert.equal(rows['Independent pathogen groups'].value, '53');
  assert.equal(rows['Complete feature vectors'].value, '90.2%');
  assert.ok(Object.values(rows).every((row) => row.passed === 'yes'));
  assert.equal(result.metrics.find((metric) => metric.label === 'Readiness').value, 'Adequate for planning');
  assert.equal(result.metrics.find((metric) => metric.label === 'Checks passed').value, '4/4');
});

test('curated pathway annotations use readable labels instead of object strings', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/pathomap-dataset.json', import.meta.url), 'utf8'));
  const dataset = ingestText(JSON.stringify(raw)).dataset;
  const report = runDiscovery(dataset);
  const result = moduleById(report, 'pathway-analysis');
  const labelsFor = (view) => view.tables[0].rows.map((row) => row.pathway);
  const broad = result.views.find((view) => view.id === 'broad');
  const detailed = result.views.find((view) => view.id === 'detailed');

  assert.equal(result.status, 'complete');
  assert.ok(broad);
  assert.ok(detailed);
  for (const labels of [labelsFor(broad), labelsFor(detailed)]) {
    assert.ok(labels.length > 0);
    assert.ok(labels.every((label) => !label.includes('[object Object]')));
  }
  assert.ok(labelsFor(broad).includes('Endocytic pathway'));
  assert.ok(labelsFor(detailed).includes('Clathrin-mediated endocytosis'));
  assert.ok(labelsFor(detailed).length > labelsFor(broad).length);
});

test('enrichment and host response use readable curated annotations', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/pathomap-dataset.json', import.meta.url), 'utf8'));
  const dataset = ingestText(JSON.stringify(raw)).dataset;
  const report = runDiscovery(dataset);

  for (const id of ['functional-enrichment', 'host-response-analysis']) {
    const result = moduleById(report, id);
    assert.equal(result.status, 'complete');
    assert.doesNotMatch(JSON.stringify(result), /\[object Object\]/);
  }
});

test('JSON dataset input bypasses column detection', () => {
  const dataset = ingestText(SAMPLE).dataset;
  const result = ingestText(JSON.stringify(dataset));
  assert.equal(result.ok, true);
  assert.equal(result.sourceKind, 'json');
  assert.equal(result.dataset.interactions.length, 4);
});
