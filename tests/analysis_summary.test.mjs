import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildInteractionAnalysisSummary } from '../js/analysis/summary.js';

const root = new URL('../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(fileURLToPath(new URL(path, root)), 'utf8'));

const analysis = readJson('data/derived/interaction_analysis.json');
const dataset = readJson('data/pathomap-dataset.json');
const sampleAnalysis = readJson('data/derived/interaction_analysis_sample.json');
const sampleDataset = readJson('data/sample-dataset.json');

function matchingDataset() {
    const copy = structuredClone(dataset);
    copy.meta.source_dataset_sha256 = analysis.meta.source_dataset_sha256;
    return copy;
}

test('summary uses the generated artifact statistics', () => {
    const summary = buildInteractionAnalysisSummary(analysis, matchingDataset());

    assert.equal(summary.status, 'ready');
    assert.deepEqual(
        summary.metrics.map((metric) => metric.value),
        [
            analysis.statistics.interaction_count,
            analysis.statistics.unique_pathogen_count,
            analysis.statistics.unique_effector_count,
            analysis.statistics.unique_host_protein_count,
            analysis.statistics.evidence_count,
        ]
    );
});

test('sample dataset has a matching generated artifact', () => {
    const sample = structuredClone(sampleDataset);
    sample.meta.source_dataset_sha256 = sampleAnalysis.meta.source_dataset_sha256;
    const summary = buildInteractionAnalysisSummary(sampleAnalysis, sample);

    assert.equal(summary.status, 'ready');
    assert.equal(summary.metrics[0].value, sampleAnalysis.statistics.interaction_count);
});

test('summary derives shared host findings from the artifact', () => {
    const summary = buildInteractionAnalysisSummary(analysis, matchingDataset());
    const sharedHosts = summary.findings.find((finding) => finding.label === 'Broadest host reuse');

    assert.match(sharedHosts.text, /ACTB is a candidate target of 7 pathogens/);
    assert.match(sharedHosts.text, /PIK3C3 is a candidate target of 5 pathogens/);
    assert.match(sharedHosts.note, /does not establish a common molecular mechanism/);

    const topHosts = structuredClone(analysis);
    topHosts.host_proteins_targeted_by_multiple_pathogens.reverse();
    const reordered = buildInteractionAnalysisSummary(topHosts, matchingDataset());
    assert.match(
        reordered.findings.find((finding) => finding.label === 'Broadest host reuse').text,
        /ACTB is a candidate target of 7 pathogens/
    );
});

test('summary derives the most connected pathogen from counts and dataset names', () => {
    const modified = structuredClone(analysis);
    modified.statistics.interactions_by_pathogen = {
        'PM-PAT-0001': 3,
        'PM-PAT-0005': 9,
    };

    const summary = buildInteractionAnalysisSummary(modified, matchingDataset());
    const connected = summary.findings.find((finding) => finding.label === 'Most connected pathogens');

    assert.match(connected.text, /Shigella flexneri/);
    assert.match(connected.text, /9 candidate relationships/);
});

test('summary reports evidence classes, coverage, unresolved targets and validation', () => {
    const summary = buildInteractionAnalysisSummary(analysis, matchingDataset());
    const evidence = summary.evidence;

    assert.deepEqual(
        Object.fromEntries(evidence.classes.map((row) => [row.key, row.count])),
        analysis.statistics.evidence_by_class
    );
    assert.equal(evidence.coverageLabel, '100%');
    assert.equal(evidence.coveredCount, analysis.statistics.interactions_with_evidence_count);
    assert.equal(evidence.unresolvedTargetCount, analysis.statistics.unresolved_target_count);
    assert.equal(evidence.validationPassed, true);
    assert.match(evidence.note, /not experimental validation/);
});

test('summary preserves all evidence classifications and failed validation', () => {
    const modified = structuredClone(analysis);
    modified.statistics.evidence_by_class = {
        experimental: 2,
        predicted: 3,
        hypothetical: 4,
        'annotation-derived': 1,
    };
    modified.validation.result_issues.push({ code: 'test_issue', detail: 'Issue' });

    const evidence = buildInteractionAnalysisSummary(modified, matchingDataset()).evidence;

    assert.deepEqual(
        evidence.classes.map((row) => [row.key, row.label, row.tone, row.count]),
        [
            ['hypothetical', 'Hypothetical', 'hypothetical', 4],
            ['predicted', 'Predicted', 'predicted', 3],
            ['experimental', 'Experimental', 'experimental', 2],
            ['annotation-derived', 'Annotation-derived', 'annotation-derived', 1],
        ]
    );
    assert.equal(evidence.validationPassed, false);
});

test('summary hides findings when the artifact does not match the dataset', () => {
    const wrongHash = matchingDataset();
    wrongHash.meta.source_dataset_sha256 = 'f'.repeat(64);
    assert.equal(buildInteractionAnalysisSummary(analysis, wrongHash).status, 'unavailable');

    const wrongTimestamp = matchingDataset();
    wrongTimestamp.meta.built_at = '2020-01-01T00:00:00Z';
    assert.equal(buildInteractionAnalysisSummary(analysis, wrongTimestamp).status, 'unavailable');

    const wrongCount = matchingDataset();
    wrongCount.interactions = wrongCount.interactions.slice(0, -1);
    assert.equal(buildInteractionAnalysisSummary(analysis, wrongCount).status, 'unavailable');

    const noArtifact = buildInteractionAnalysisSummary(null, matchingDataset());
    assert.equal(noArtifact.status, 'unavailable');
    assert.match(noArtifact.reason, /No generated analysis is available/);
    assert.equal(buildInteractionAnalysisSummary(analysis, null).status, 'unavailable');
});

test('summary hides findings when required statistics are missing', () => {
    const modified = structuredClone(analysis);
    delete modified.statistics.unique_host_protein_count;

    const summary = buildInteractionAnalysisSummary(modified, matchingDataset());

    assert.equal(summary.status, 'unavailable');
    assert.equal(summary.findings.length, 0);
    assert.equal(summary.metrics.length, 0);
});
