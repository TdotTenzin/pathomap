import test from 'node:test';
import assert from 'node:assert/strict';

import {
    analysisMatchesDataset,
    buildEdgeDetail,
    buildNetworkModel,
    buildNodeDetail,
    filterNetwork,
    getFilterOptions,
} from '../js/analysis/network.js';
import { toCsv } from '../js/utils/export.js';
import { createNetworkLayout } from '../js/views/network-physics.js';
import {
    edgeCurvature,
    edgePath,
    fitTransform,
    seedOrganicPositions,
    sharedHostPathogens,
} from '../js/views/network-layout.js';

function fixture() {
    return {
        meta: {
            schema_version: '3.0',
            built_at: '2026-01-01T00:00:00Z',
            sha256: 'a'.repeat(64),
        },
        pathogens: [
            { entity_id: 'PM-PAT-0001', pathogen_id: 1, name: 'Pathogen A', gram_stain: 'Gram-negative', tax_id: 1 },
            { entity_id: 'PM-PAT-0002', pathogen_id: 2, name: 'Pathogen B', gram_stain: 'Gram-positive', tax_id: 2 },
        ],
        effectors: [
            {
                entity_id: 'PM-EFF-0001',
                effector_name: 'Effector A',
                pathogen_id: 1,
                pathogen_name: 'Pathogen A',
                type: 'T3SS',
                mechanism: 'Membrane trafficking',
                host_target_id: 1,
            },
            {
                entity_id: 'PM-EFF-0002',
                effector_name: 'Effector B',
                pathogen_id: 2,
                pathogen_name: 'Pathogen B',
                type: 'Toxin',
                mechanism: 'Immune evasion',
                host_target_id: 1,
            },
        ],
        host_proteins: [
            {
                entity_id: 'PM-HST-0001',
                host_protein_id: 1,
                protein_name: 'Host protein A',
                gene_name: 'HOSTA',
                uniprot_id: 'P00001',
            },
        ],
        host_targets: [{ host_target_id: 1, resolution_status: 'resolved_protein' }],
        interactions: [
            {
                interaction_id: 'PM-INT-0001',
                effector_id: 'PM-EFF-0001',
                host_protein_id: 'PM-HST-0001',
                mechanism: 'Membrane trafficking',
                interaction_type: 'effector_targets_host_protein',
                provenance: 'fixture',
            },
            {
                interaction_id: 'PM-INT-0002',
                effector_id: 'PM-EFF-0002',
                host_protein_id: 'PM-HST-0001',
                mechanism: 'Immune evasion',
                interaction_type: 'Toxin',
                provenance: 'fixture',
            },
        ],
        interaction_evidence: [
            {
                evidence_id: 'PM-EVD-0001',
                interaction_id: 'PM-INT-0001',
                evidence_class: 'experimental',
                doi: '10.1000/a',
                provenance: 'fixture',
            },
            {
                evidence_id: 'PM-EVD-0002',
                interaction_id: 'PM-INT-0002',
                evidence_class: 'predicted',
                provenance: 'fixture',
            },
        ],
    };
}

function matchingAnalysis(dataset) {
    return {
        meta: {
            analysis: 'interaction_analysis',
            analysis_version: '1.1',
            source_dataset_built_at: dataset.meta.built_at,
            source_dataset_schema_version: dataset.meta.schema_version,
            source_dataset_sha256: dataset.meta.sha256,
        },
        validation: { raw_interaction_count: dataset.interactions.length },
        statistics: { interaction_count: dataset.interactions.length },
        network: {
            nodes: [
                { id: 'PM-PAT-0001', type: 'pathogen', label: 'Pathogen A', classification: 'Virus' },
                { id: 'PM-EFF-0001', type: 'effector', label: 'Effector A', pathogen_id: 'PM-PAT-0001' },
                { id: 'PM-HST-0001', type: 'host_protein', label: 'Host protein A', gene_name: 'HOSTA' },
            ],
            edges: [
                {
                    id: 'PM-INT-0001',
                    source: 'PM-EFF-0001',
                    target: 'PM-HST-0001',
                    type: 'effector_targets_host_protein',
                    pathogen_id: 'PM-PAT-0001',
                    evidence_classes: ['experimental'],
                    strongest_evidence_class: 'experimental',
                    evidence_records: [],
                },
            ],
        },
        unresolved_targets: { target_count: 0, effector_count: 0 },
    };
}

test('derived analysis is used only when it matches the loaded dataset', () => {
    const dataset = fixture();
    const analysis = matchingAnalysis(dataset);

    assert.equal(analysisMatchesDataset(analysis, dataset), true);
    const model = buildNetworkModel(dataset, analysis);
    assert.equal(model.source.kind, 'derived');
    assert.equal(model.source.verified, true);
    assert.equal(model.nodes.find((node) => node.id === 'PM-PAT-0001').classification, 'Virus');

    analysis.statistics.interaction_count = 99;
    assert.equal(analysisMatchesDataset(analysis, dataset), false);
    analysis.statistics.interaction_count = dataset.interactions.length;

    analysis.validation.raw_interaction_count = 1;
    assert.equal(analysisMatchesDataset(analysis, dataset), false);
    analysis.validation.raw_interaction_count = dataset.interactions.length;

    analysis.meta.source_dataset_sha256 = 'b'.repeat(64);
    assert.equal(analysisMatchesDataset(analysis, dataset), false);
    delete analysis.meta.source_dataset_sha256;
    assert.equal(analysisMatchesDataset(analysis, dataset), false);
    assert.equal(buildNetworkModel(dataset, analysis).source.kind, 'dataset');
});

test('dataset fallback adds pathogen membership links and evidence classes', () => {
    const model = buildNetworkModel(fixture(), null);

    assert.equal(model.source.kind, 'dataset');
    assert.equal(model.nodes.length, 5);
    assert.equal(model.interactionEdges.length, 2);
    assert.equal(model.membershipEdges.length, 2);
    assert.equal(model.interactionEdges[0].strongest_evidence_class, 'experimental');
    assert.equal(model.interactionEdges[0].evidence_classes[0], 'experimental');
});

test('filters combine pathogen, host, evidence, type, classification, and search', () => {
    const model = buildNetworkModel(fixture(), null);

    const predicted = filterNetwork(model, { evidenceClass: 'predicted' });
    assert.equal(predicted.counts.interactions, 1);
    assert.equal(predicted.interactionEdges[0].id, 'PM-INT-0002');
    assert.equal(predicted.membershipEdges.length, 1);

    assert.equal(filterNetwork(model, { pathogenId: 'PM-PAT-0001' }).counts.interactions, 1);
    assert.equal(filterNetwork(model, { hostProteinId: 'PM-HST-0001' }).counts.interactions, 2);
    assert.equal(filterNetwork(model, { interactionType: 'Toxin' }).counts.interactions, 1);
    assert.equal(filterNetwork(model, { classification: 'Gram-positive' }).counts.interactions, 1);
    assert.equal(filterNetwork(model, { search: 'immune evasion' }).counts.interactions, 1);
    assert.equal(filterNetwork(model, { search: '10.1000/a' }).counts.interactions, 1);
});

test('filter options and details use stable IDs and joined biology', () => {
    const dataset = fixture();
    const model = buildNetworkModel(dataset, null);
    const options = getFilterOptions(model);

    assert.equal(options.pathogens.length, 2);
    assert.equal(options.hostProteins[0].value, 'PM-HST-0001');
    assert.deepEqual(options.evidenceClasses, ['experimental', 'predicted']);
    assert.deepEqual(options.interactionTypes, ['Toxin', 'effector_targets_host_protein']);

    const nodeDetail = buildNodeDetail(dataset, model, 'PM-EFF-0001');
    assert.equal(nodeDetail.title, 'Effector A');
    assert.equal(nodeDetail.related.length, 2);
    assert.equal(nodeDetail.evidence[0].doi, '10.1000/a');

    const edgeDetail = buildEdgeDetail(dataset, model, 'PM-INT-0002');
    assert.equal(edgeDetail.kind, 'edge');
    assert.equal(edgeDetail.evidence[0].evidence_class, 'predicted');
});

test('evidence reused across interactions is retained in details', () => {
    const dataset = fixture();
    dataset.interaction_evidence.push({
        evidence_id: 'PM-EVD-0001',
        interaction_id: 'PM-INT-0002',
        evidence_class: 'experimental',
        doi: '10.1000/a',
        provenance: 'fixture',
    });
    const model = buildNetworkModel(dataset, null);

    const nodeDetail = buildNodeDetail(dataset, model, 'PM-HST-0001');
    assert.equal(nodeDetail.evidence.length, 3);
    assert.equal(
        nodeDetail.evidence.filter((record) => record.evidence_id === 'PM-EVD-0001').length,
        2
    );

    const edgeDetail = buildEdgeDetail(dataset, model, 'PM-INT-0002');
    assert.equal(edgeDetail.evidence.length, 2);
});

test('CSV output escapes commas, quotes, and newlines', () => {
    const csv = toCsv(
        [{ key: 'name', label: 'name' }, { key: 'note', label: 'note' }],
        [{ name: 'A, B', note: 'He said "hello"\nnext line' }]
    );
    assert.equal(csv, 'name,note\n"A, B","He said ""hello""\nnext line"\n');
});

test('physics layout separates overlapping nodes without fixed lanes', () => {
    const layout = createNetworkLayout({
        nodes: [
            { id: 'a', type: 'host_protein', x: 448, y: 300 },
            { id: 'b', type: 'host_protein', x: 452, y: 300 },
        ],
        links: [],
        width: 900,
        height: 600,
        radius: 14,
    });

    layout.reheat(1);
    for (let index = 0; index < 120; index += 1) layout.tick();

    const [first, second] = layout.bodies;
    assert.ok(Math.hypot(second.x - first.x, second.y - first.y) >= 27.5);
    assert.ok(Number.isFinite(first.x) && Number.isFinite(first.y));
    assert.ok(first.x > 0 && first.x < 900);
});

test('physics layout pulls linked nodes closer and pushes unlinked nodes apart', () => {
    const linked = createNetworkLayout({
        nodes: [
            { id: 'effector', type: 'effector', x: 300, y: 150 },
            { id: 'host', type: 'host_protein', x: 600, y: 450 },
        ],
        links: [{ source: 'effector', target: 'host', kind: 'interaction' }],
        width: 900,
        height: 600,
        radius: 14,
    });
    const distance = () =>
        Math.hypot(linked.get('host').x - linked.get('effector').x, linked.get('host').y - linked.get('effector').y);
    const before = distance();
    linked.reheat(1);
    for (let index = 0; index < 120; index += 1) linked.tick();
    assert.ok(distance() < before * 0.6);

    const separate = createNetworkLayout({
        nodes: [
            { id: 'one', type: 'effector', x: 440, y: 300 },
            { id: 'two', type: 'host_protein', x: 460, y: 300 },
        ],
        links: [],
        width: 900,
        height: 600,
        radius: 14,
    });
    const initialGap = Math.hypot(
        separate.get('two').x - separate.get('one').x,
        separate.get('two').y - separate.get('one').y
    );
    separate.reheat(1);
    for (let index = 0; index < 120; index += 1) separate.tick();
    const finalGap = Math.hypot(
        separate.get('two').x - separate.get('one').x,
        separate.get('two').y - separate.get('one').y
    );
    assert.ok(finalGap > initialGap);
});

test('physics layout pins dragged nodes, releases them with velocity, and resets', () => {
    const layout = createNetworkLayout({
        nodes: [{ id: 'node', type: 'pathogen', x: 200, y: 200 }],
        links: [],
        width: 900,
        height: 600,
        radius: 14,
    });

    layout.setPinned('node', 300, 220);
    assert.equal(layout.get('node').fx, 300);
    layout.tick();
    assert.equal(layout.get('node').x, 300);

    layout.release('node', 8, -4);
    assert.equal(layout.get('node').fx, null);
    const startX = layout.get('node').x;
    for (let index = 0; index < 10; index += 1) layout.tick();
    assert.ok(layout.get('node').x > startX);

    layout.reset();
    assert.equal(layout.get('node').x, 200);
    assert.equal(layout.get('node').y, 200);
    assert.equal(layout.get('node').fx, null);
});

test('organic seeding spreads nodes deterministically inside the canvas', () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
        id: `n${index}`,
        type: index % 3 === 0 ? 'pathogen' : index % 3 === 1 ? 'effector' : 'host_protein',
    }));
    const links = nodes.slice(1).map((node, index) => ({ source: nodes[index].id, target: node.id }));

    seedOrganicPositions(nodes, 920, 800, links);
    const positions = nodes.map(({ x, y }) => `${x.toFixed(2)}:${y.toFixed(2)}`);

    assert.equal(new Set(positions).size, nodes.length);
    nodes.forEach((node) => {
        assert.ok(node.x > 0 && node.x < 920);
        assert.ok(node.y > 0 && node.y < 800);
    });

    const again = nodes.map((node) => ({ id: node.id, type: node.type }));
    seedOrganicPositions(again, 920, 800, links);
    assert.deepEqual(
        again.map(({ x, y }) => `${x.toFixed(2)}:${y.toFixed(2)}`),
        positions
    );
});

test('shared host detection uses only curated pathogen IDs on interaction edges', () => {
    const shared = sharedHostPathogens([
        { target: 'HOST-1', pathogen_id: 'PAT-A' },
        { target: 'HOST-1', pathogen_id: 'PAT-B' },
        { target: 'HOST-1', pathogen_id: 'PAT-A', evidence_class: 'predicted' },
        { target: 'HOST-2', pathogen_id: 'PAT-A' },
        { target: 'HOST-3', pathogen_id: null },
        { source: 'EFF-1', target: 'HOST-4', interacting_partners: ['STRING-PARTNER'] },
    ]);

    assert.deepEqual([...shared.keys()], ['HOST-1']);
    assert.deepEqual([...shared.get('HOST-1')], ['PAT-A', 'PAT-B']);
    assert.ok(!shared.has('HOST-3'));
    assert.ok(!shared.has('HOST-4'));
});

test('edge paths curve deterministically and fit transform centres the graph', () => {
    const curvature = edgeCurvature('PM-INT-0002');
    assert.equal(curvature, edgeCurvature('PM-INT-0002'));
    assert.ok(edgePath({ x: 10, y: 20 }, { x: 110, y: 80 }, curvature).includes(' Q '));
    assert.ok(edgePath({ x: 10, y: 20 }, { x: 110, y: 80 }, 0).includes(' L '));

    const transform = fitTransform(
        [
            { x: 100, y: 100, labelRadius: 20, spacingY: 23 },
            { x: 500, y: 300, labelRadius: 20, spacingY: 23 },
        ],
        920,
        620
    );
    assert.ok(transform.zoom > 0 && transform.zoom <= 1.8);
    assert.ok(Number.isFinite(transform.x) && Number.isFinite(transform.y));
});
